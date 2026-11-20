/**
 * Browser client for the local Director proxy. Same-origin relative URLs only:
 * the browser never talks to Gemini and never sees the API key.
 *
 * Every response is treated as untrusted: its shape is checked here and the
 * proposal text is validated again by `parseProposalText` in the controller.
 */
import type { ValidationIssue } from './validate';

export const DIRECTOR_ENDPOINT = '/api/director';
export const HEALTH_ENDPOINT = '/api/director/health';
const MAX_RESPONSE_CHARS = 256 * 1024;

export type ProxyMode = 'live' | 'recorded';

export interface DirectorRequestBody {
  /** 'morph' is accepted by the proxy only when started with DIRECTOR_MORPH=1. */
  readonly mode: 'create' | 'edit' | 'morph';
  readonly prompt: string;
  readonly world: {
    readonly worldName: string;
    readonly biome: string;
    readonly entityCount: number;
    readonly entities: readonly unknown[];
  };
}

export type ClientResult =
  | {
      readonly ok: true;
      readonly mode: ProxyMode;
      readonly requestId: string;
      readonly text: string;
      readonly model?: string;
      readonly recordingId?: string;
      readonly recordingLabel?: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly mode?: ProxyMode;
      readonly requestId?: string;
      readonly retryAfterSec?: number;
      readonly issues: readonly ValidationIssue[];
    };

export interface HealthInfo {
  readonly mode: ProxyMode;
  readonly model: string;
  readonly keyConfigured: boolean;
  readonly liveReady: boolean;
  readonly modeReason: string;
  /** World Morph requests accepted by the server (DIRECTOR_MORPH=1). Off by default. */
  readonly morphEnabled: boolean;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

export async function requestProposal(body: DirectorRequestBody, options: { signal?: AbortSignal; fetchImpl?: FetchFn } = {}): Promise<ClientResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  let response: Response;
  try {
    response = await fetchImpl(DIRECTOR_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return failure('CANCELLED', 'The request was cancelled.');
    }
    return failure('NETWORK', 'Could not reach the Director proxy. Is the WORLDWEAVER server running?');
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    if (options.signal?.aborted) return failure('CANCELLED', 'The request was cancelled.');
    return failure('NETWORK', 'The connection to the Director proxy was interrupted.');
  }
  if (raw.length > MAX_RESPONSE_CHARS) return failure('MALFORMED_RESPONSE', 'The Director proxy returned an unexpectedly large response.');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return failure('MALFORMED_RESPONSE', `The Director proxy returned an unreadable response (HTTP ${response.status}).`);
  }
  return readResult(data, response.status);
}

export async function fetchHealth(options: { signal?: AbortSignal; fetchImpl?: FetchFn } = {}): Promise<HealthInfo | null> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  try {
    const response = await fetchImpl(HEALTH_ENDPOINT, { cache: 'no-store', credentials: 'same-origin', ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) return null;
    const d = (await response.json()) as Record<string, unknown>;
    if (d.ok !== true || (d.mode !== 'live' && d.mode !== 'recorded')) return null;
    return {
      mode: d.mode,
      model: str(d.model, 80) ?? 'unknown',
      keyConfigured: d.keyConfigured === true,
      liveReady: d.liveReady === true,
      modeReason: str(d.modeReason, 160) ?? '',
      morphEnabled: d.morphEnabled === true,
    };
  } catch {
    return null;
  }
}

function readResult(data: unknown, status: number): ClientResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return failure('MALFORMED_RESPONSE', `Unexpected response from the Director proxy (HTTP ${status}).`);
  const d = data as Record<string, unknown>;
  const mode = d.mode === 'live' || d.mode === 'recorded' ? d.mode : undefined;
  const requestId = str(d.requestId, 64);
  if (d.ok === true) {
    if (typeof d.text !== 'string' || !mode || !requestId) return failure('MALFORMED_RESPONSE', 'The Director proxy response is missing required fields.');
    const model = str(d.model, 80);
    const recordingId = str(d.recordingId, 80);
    const recordingLabel = str(d.recordingLabel, 120);
    return {
      ok: true,
      mode,
      requestId,
      text: d.text,
      ...(model ? { model } : {}),
      ...(recordingId ? { recordingId } : {}),
      ...(recordingLabel ? { recordingLabel } : {}),
    };
  }
  const code = typeof d.code === 'string' && /^[A-Z_]{2,40}$/.test(d.code) ? d.code : 'UPSTREAM';
  const message = str(d.message, 300) ?? `The Director proxy reported an error (HTTP ${status}).`;
  const retryAfterSec = typeof d.retryAfterSec === 'number' && Number.isFinite(d.retryAfterSec) && d.retryAfterSec >= 0 ? Math.min(3600, Math.ceil(d.retryAfterSec)) : undefined;
  const issues = Array.isArray(d.issues)
    ? d.issues.slice(0, 10).flatMap((i): ValidationIssue[] => {
        if (!i || typeof i !== 'object') return [];
        const r = i as Record<string, unknown>;
        const path = str(r.path, 120) ?? '';
        const msg = str(r.message, 200);
        const c = typeof r.code === 'string' && /^[a-z_]{2,40}$/.test(r.code) ? (r.code as ValidationIssue['code']) : 'invalid_type';
        return msg ? [{ path, code: c, message: msg }] : [];
      })
    : [];
  return {
    ok: false,
    code,
    message,
    issues,
    ...(mode ? { mode } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
  };
}

function failure(code: string, message: string): ClientResult {
  return { ok: false, code, message, issues: [] };
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
  if (clean.length === 0) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
