/**
 * One upstream call to Gemini generateContent. No retries here or anywhere:
 * retrying is always an explicit user action.
 */
import type { DirectorConfig } from './config';

export type UpstreamErrorCode =
  | 'NO_KEY'
  | 'AUTH'
  | 'MODEL_NOT_FOUND'
  | 'UPSTREAM_BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'BLOCKED_SAFETY'
  | 'TRUNCATED'
  | 'EMPTY';

export type UpstreamResult =
  | { readonly ok: true; readonly text: string; readonly finishReason: string; readonly modelVersion?: string }
  | { readonly ok: false; readonly code: UpstreamErrorCode; readonly message: string; readonly status?: number; readonly retryAfterSec?: number };

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const MAX_UPSTREAM_BYTES = 1024 * 1024;
const SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);

export async function callGemini(
  config: DirectorConfig,
  body: unknown,
  options: { fetchImpl: FetchLike; signal: AbortSignal },
): Promise<UpstreamResult> {
  const key = config.getApiKey();
  if (!key) return { ok: false, code: 'NO_KEY', message: 'Live mode needs GEMINI_API_KEY in the server environment.' };

  // The key travels ONLY in this header. The URL never contains it.
  const url = `${config.apiBase}/models/${encodeURIComponent(config.model)}:generateContent`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  const onCancel = () => timeout.abort();
  options.signal.addEventListener('abort', onCancel, { once: true });

  try {
    const res = await options.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const raw = await res.text();
    if (raw.length > MAX_UPSTREAM_BYTES) return { ok: false, code: 'UPSTREAM', message: 'Gemini returned an unexpectedly large response.', status: res.status };

    if (!res.ok) return mapHttpError(res.status, raw, res.headers.get('retry-after'));

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, code: 'UPSTREAM', message: 'Gemini returned a response that is not JSON.', status: res.status };
    }
    return readCandidate(data);
  } catch (error) {
    if (options.signal.aborted) return { ok: false, code: 'CANCELLED', message: 'The request was cancelled.' };
    if (timeout.signal.aborted) return { ok: false, code: 'TIMEOUT', message: `Gemini did not answer within ${Math.round(config.timeoutMs / 1000)} s.` };
    return { ok: false, code: 'NETWORK', message: `Could not reach Gemini (${safeName(error)}).` };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onCancel);
  }
}

function readCandidate(data: unknown): UpstreamResult {
  const d = (data ?? {}) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown }> } }>;
    modelVersion?: string;
  };
  if (d.promptFeedback?.blockReason) {
    return { ok: false, code: 'BLOCKED_SAFETY', message: 'Gemini blocked this request with its safety filters.' };
  }
  const candidate = Array.isArray(d.candidates) ? d.candidates[0] : undefined;
  if (!candidate) return { ok: false, code: 'EMPTY', message: 'Gemini returned no proposal.' };
  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'UNKNOWN';
  if (SAFETY_REASONS.has(finishReason)) return { ok: false, code: 'BLOCKED_SAFETY', message: 'Gemini stopped this response with its safety filters.' };
  if (finishReason === 'MAX_TOKENS') return { ok: false, code: 'TRUNCATED', message: 'The proposal was cut off because it was too long. Try a smaller request.' };
  const text = (candidate.content?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  if (text.trim().length === 0) return { ok: false, code: 'EMPTY', message: 'Gemini returned an empty proposal.' };
  return { ok: true, text, finishReason, ...(typeof d.modelVersion === 'string' ? { modelVersion: d.modelVersion } : {}) };
}

function mapHttpError(status: number, raw: string, retryAfterHeader: string | null): UpstreamResult {
  const retryAfterSec = retryAfter(raw, retryAfterHeader);
  if (status === 429) {
    return { ok: false, code: 'RATE_LIMITED', status, message: 'Gemini rate limit or quota reached.', ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) };
  }
  if (status === 401 || status === 403) return { ok: false, code: 'AUTH', status, message: 'Gemini rejected the configured API key or its permissions.' };
  if (status === 404) return { ok: false, code: 'MODEL_NOT_FOUND', status, message: 'The configured Gemini model was not found.' };
  if (status === 400) return { ok: false, code: 'UPSTREAM_BAD_REQUEST', status, message: 'Gemini rejected the request format.' };
  return { ok: false, code: 'UPSTREAM', status, message: `Gemini returned an error (HTTP ${status}).` };
}

/** Reads Retry-After seconds, or google.rpc.RetryInfo "retryDelay": "13s". */
function retryAfter(raw: string, header: string | null): number | undefined {
  const fromHeader = header !== null ? Number(header) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) return Math.min(3600, Math.ceil(fromHeader));
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
  if (match?.[1]) return Math.min(3600, Math.ceil(Number(match[1])));
  return undefined;
}

function safeName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'error';
  return /^[A-Za-z]{1,40}$/.test(name) ? name : 'error';
}
