/**
 * WORLDWEAVER Director proxy — a plain Node.js (24) HTTP handler.
 *
 *   GET  /api/director/health   configuration diagnostics (never secrets)
 *   POST /api/director          { mode, prompt, world } → validated proposal text
 *
 * Security properties:
 * - The Gemini key lives only in server memory (config closure) and is sent
 *   upstream only in the x-goog-api-key header. It is never logged, returned,
 *   or put in a URL.
 * - Localhost-only Host, same-origin Origin, Sec-Fetch-Site checks (also
 *   protects against DNS rebinding and cross-site requests).
 * - Strict request validation and size limits; one request at a time; at
 *   least `minIntervalMs` between live upstream calls; upstream timeout; no
 *   automatic retries.
 * - Model output is validated server-side before the browser sees it, and
 *   the browser validates again.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseProposalText, type ValidationIssue } from '../../src/director/validate';
import type { DirectorConfig, DirectorMode } from './config';
import { callGemini, type FetchLike, type UpstreamErrorCode } from './gemini';
import { buildGeminiBody } from './prompt';
import { RECORDINGS, selectRecording, SIMULATED_BODIES, simulatedError } from './recordings';
import { REQUEST_LIMITS, validateDirectorRequest, type DirectorRequest } from './request';

export const DIRECTOR_PATH = '/api/director';
export const HEALTH_PATH = '/api/director/health';
export const MAX_REPORTED_ISSUES = 10;

export type ProxyErrorCode =
  | UpstreamErrorCode
  | 'BAD_REQUEST'
  | 'FORBIDDEN_ORIGIN'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TOO_LARGE'
  | 'BUSY'
  | 'LOCAL_RATE_LIMITED'
  | 'INVALID_PROPOSAL'
  | 'NOT_FOUND';

export interface ProxySuccess {
  readonly ok: true;
  readonly mode: DirectorMode;
  readonly requestId: string;
  readonly text: string;
  readonly model?: string;
  readonly finishReason?: string;
  readonly recordingId?: string;
  readonly recordingLabel?: string;
}

export interface ProxyFailure {
  readonly ok: false;
  readonly mode: DirectorMode;
  readonly requestId: string;
  readonly code: ProxyErrorCode;
  readonly message: string;
  readonly retryAfterSec?: number;
  readonly issues?: readonly ValidationIssue[];
}

export interface HealthReport {
  readonly ok: true;
  readonly service: 'worldweaver-director';
  readonly mode: DirectorMode;
  readonly modeReason: string;
  readonly model: string;
  readonly keyConfigured: boolean;
  /** True only when live requests can actually be made. */
  readonly liveReady: boolean;
  readonly recordings: number;
  readonly limits: { readonly maxPromptChars: number; readonly maxBodyBytes: number; readonly minIntervalSec: number; readonly timeoutSec: number };
}

export interface DirectorLogger {
  info(record: Readonly<Record<string, string | number | boolean>>): void;
}

export interface HandlerOptions {
  readonly config: DirectorConfig;
  readonly fetchImpl?: FetchLike;
  readonly logger?: DirectorLogger;
  readonly now?: () => number;
}

type Next = (error?: unknown) => void;
export type DirectorHandler = (req: IncomingMessage, res: ServerResponse, next?: Next) => void;

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

const STATUS: Readonly<Record<ProxyErrorCode, number>> = {
  BAD_REQUEST: 400,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BLOCKED_SAFETY: 422,
  BUSY: 429,
  LOCAL_RATE_LIMITED: 429,
  RATE_LIMITED: 429,
  NO_KEY: 503,
  AUTH: 502,
  MODEL_NOT_FOUND: 502,
  UPSTREAM_BAD_REQUEST: 502,
  UPSTREAM: 502,
  NETWORK: 502,
  TRUNCATED: 502,
  EMPTY: 502,
  INVALID_PROPOSAL: 502,
  TIMEOUT: 504,
  CANCELLED: 499,
};

export const defaultLogger: DirectorLogger = {
  info: (record) => console.info(`[director] ${JSON.stringify(record)}`),
};

export function createDirectorHandler(options: HandlerOptions): DirectorHandler {
  const { config } = options;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  let inFlight = false;
  let lastUpstreamAt = Number.NEGATIVE_INFINITY;

  const health = (): HealthReport => ({
    ok: true,
    service: 'worldweaver-director',
    mode: config.mode,
    modeReason: config.modeReason,
    model: config.model,
    keyConfigured: config.keyConfigured,
    liveReady: config.mode === 'live' && config.keyConfigured,
    recordings: RECORDINGS.length,
    limits: {
      maxPromptChars: REQUEST_LIMITS.maxPromptChars,
      maxBodyBytes: REQUEST_LIMITS.maxBodyBytes,
      minIntervalSec: Math.ceil(config.minIntervalMs / 1000),
      timeoutSec: Math.ceil(config.timeoutMs / 1000),
    },
  });

  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path !== DIRECTOR_PATH && !path.startsWith(`${DIRECTOR_PATH}/`)) {
      if (next) next();
      else sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Not found.' });
      return;
    }
    void handle(req, res, path).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'UPSTREAM', message: 'Internal Director error.' });
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const requestId = randomUUID();
    const started = now();
    const fail = (code: ProxyErrorCode, message: string, extra: Partial<ProxyFailure> = {}, log: Record<string, string | number | boolean> = {}) => {
      const body: ProxyFailure = { ok: false, mode: config.mode, requestId, code, message, ...extra };
      if (code !== 'CANCELLED' && !res.writableEnded && !res.destroyed) sendJson(res, STATUS[code], body, code === 'METHOD_NOT_ALLOWED' ? { allow: path === HEALTH_PATH ? 'GET' : 'POST' } : {});
      logger.info({ event: 'director.request', requestId, mode: config.mode, status: STATUS[code], code, ms: now() - started, ...log });
    };

    const origin = checkOrigin(req);
    if (origin) return fail('FORBIDDEN_ORIGIN', origin);

    if (path === HEALTH_PATH) {
      if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Use GET for the health check.');
      sendJson(res, 200, health());
      return;
    }
    if (path !== DIRECTOR_PATH) return fail('NOT_FOUND', 'Unknown Director endpoint.');
    if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Use POST to request a proposal.');
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') return fail('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');

    const body = await readBody(req, REQUEST_LIMITS.maxBodyBytes);
    if (!body.ok) return fail(body.code, body.message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return fail('BAD_REQUEST', 'Request body is not valid JSON.');
    }
    const valid = validateDirectorRequest(parsed);
    if (!valid.ok) return fail('BAD_REQUEST', valid.message);
    const request = valid.request;
    const logBase = { promptChars: request.prompt.length, entities: request.world.entityCount, task: request.mode };

    if (inFlight) return fail('BUSY', 'Another Director request is still running.', { retryAfterSec: 1 }, logBase);
    if (config.mode === 'live') {
      const wait = lastUpstreamAt + config.minIntervalMs - now();
      if (wait > 0) {
        return fail('LOCAL_RATE_LIMITED', 'Please wait before sending another live request.', { retryAfterSec: Math.ceil(wait / 1000) }, logBase);
      }
    }

    // Cancel work if the browser goes away (Cancel button, navigation).
    const cancel = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) cancel.abort();
    };
    res.on('close', onClose);
    inFlight = true;
    try {
      const outcome = config.mode === 'live' ? await live(request, cancel.signal) : await recorded(request, cancel.signal);
      if (!outcome.ok) return fail(outcome.code, outcome.message, outcome.retryAfterSec !== undefined ? { retryAfterSec: outcome.retryAfterSec } : {}, logBase);

      const checked = parseProposalText(outcome.text);
      if (!checked.ok) {
        return fail('INVALID_PROPOSAL', 'The proposal did not pass validation.', { issues: checked.errors.slice(0, MAX_REPORTED_ISSUES) }, {
          ...logBase,
          issues: checked.errors.length,
          ...(outcome.recordingId ? { recordingId: outcome.recordingId } : {}),
        });
      }
      const success: ProxySuccess = { ok: true, mode: config.mode, requestId, text: outcome.text, ...outcome.extra };
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, success);
      logger.info({ event: 'director.request', requestId, mode: config.mode, status: 200, ms: now() - started, operations: checked.proposal.operations.length, ...logBase, ...(outcome.recordingId ? { recordingId: outcome.recordingId } : {}) });
    } finally {
      inFlight = false;
      res.off('close', onClose);
    }
  }

  type Outcome =
    | { ok: true; text: string; recordingId?: string; extra: Partial<ProxySuccess> }
    | { ok: false; code: ProxyErrorCode; message: string; retryAfterSec?: number };

  async function live(request: DirectorRequest, signal: AbortSignal): Promise<Outcome> {
    if (!config.keyConfigured) return { ok: false, code: 'NO_KEY', message: 'Live mode needs GEMINI_API_KEY in the server environment.' };
    lastUpstreamAt = now(); // counts failed calls too, so errors cannot be used to hammer the API
    const result = await callGemini(config, buildGeminiBody(request), { fetchImpl, signal });
    if (!result.ok) return { ok: false, code: result.code, message: result.message, ...(result.retryAfterSec !== undefined ? { retryAfterSec: result.retryAfterSec } : {}) };
    return { ok: true, text: result.text, extra: { model: result.modelVersion ?? config.model, finishReason: result.finishReason } };
  }

  async function recorded(request: DirectorRequest, signal: AbortSignal): Promise<Outcome> {
    await delay(config.recordedLatencyMs, signal);
    if (signal.aborted) return { ok: false, code: 'CANCELLED', message: 'The request was cancelled.' };
    const simulated = simulatedError(request.prompt);
    if (simulated) {
      switch (simulated) {
        case 'RATE_LIMITED':
          return { ok: false, code: 'RATE_LIMITED', message: 'Simulated rate limit (recorded mode).', retryAfterSec: 8 };
        case 'TIMEOUT':
          return { ok: false, code: 'TIMEOUT', message: 'Simulated timeout (recorded mode).' };
        case 'UPSTREAM':
          return { ok: false, code: 'UPSTREAM', message: 'Simulated upstream error (recorded mode).' };
        case 'BLOCKED_SAFETY':
          return { ok: false, code: 'BLOCKED_SAFETY', message: 'Simulated safety block (recorded mode).' };
        case 'AUTH':
          return { ok: false, code: 'AUTH', message: 'Simulated authentication error (recorded mode).' };
        default:
          return { ok: true, text: SIMULATED_BODIES[simulated], recordingId: `simulated-${simulated.toLowerCase()}`, extra: { recordingId: `simulated-${simulated.toLowerCase()}` } };
      }
    }
    const recording = selectRecording(request.mode, request.prompt);
    return {
      ok: true,
      text: JSON.stringify(recording.response),
      recordingId: recording.id,
      extra: { recordingId: recording.id, recordingLabel: recording.label },
    };
  }
}

/** Returns a reason string if the request must be refused, else null. */
function checkOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host) return 'Missing Host header.';
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return 'Invalid Host header.';
  }
  if (!LOCAL_HOSTNAMES.has(hostUrl.hostname)) return 'The Director only accepts requests to localhost.';

  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';

  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    let o: URL;
    try {
      o = new URL(origin);
    } catch {
      return 'Invalid Origin header.';
    }
    if (o.protocol !== 'http:' || o.host !== hostUrl.host) return 'Cross-origin requests are not allowed.';
  }
  return null;
}

type BodyResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: 'TOO_LARGE' | 'BAD_REQUEST'; readonly message: string };

function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume(); // drain and discard
    return Promise.resolve({ ok: false, code: 'TOO_LARGE', message: `Request body exceeds ${limit} bytes.` });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (result: BodyResult) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        finish({ ok: false, code: 'TOO_LARGE', message: `Request body exceeds ${limit} bytes.` });
        return; // keep draining; the response is sent by the caller
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        finish({ ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) });
      } catch {
        finish({ ok: false, code: 'BAD_REQUEST', message: 'Request body is not valid UTF-8.' });
      }
    });
    req.on('error', () => finish({ ok: false, code: 'BAD_REQUEST', message: 'Could not read the request body.' }));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString(),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(payload);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
