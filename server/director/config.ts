/**
 * Director proxy configuration, read from environment variables only.
 *
 * The API key is captured in a closure and exposed solely through
 * `getApiKey()` for the upstream request header. It is never serialised,
 * logged or returned by diagnostics.
 */
export type DirectorMode = 'live' | 'recorded';

export interface DirectorConfig {
  readonly mode: DirectorMode;
  /** Why this mode was chosen (safe to show the user). */
  readonly modeReason: string;
  readonly model: string;
  readonly keyConfigured: boolean;
  readonly timeoutMs: number;
  readonly minIntervalMs: number;
  readonly recordedLatencyMs: number;
  readonly apiBase: string;
  /** World Morph requests are accepted only when DIRECTOR_MORPH=1 (default off until WW-025 and WW-030 pass). */
  readonly morphEnabled: boolean;
  /** Returns the key for the upstream header. Never log or return its value. */
  getApiKey(): string | null;
}

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]{1,62}$/;

export interface ConfigOverrides {
  readonly minIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly recordedLatencyMs?: number;
  readonly apiBase?: string;
  readonly morphEnabled?: boolean;
}

function intFrom(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Environment variables:
 * - GEMINI_API_KEY             server-side only; never sent to the browser
 * - DIRECTOR_MODE              "live" | "recorded" (default: live if a key is set, else recorded)
 * - GEMINI_MODEL               default gemini-3.5-flash-lite
 * - DIRECTOR_TIMEOUT_MS        1000..60000, default 30000
 * - DIRECTOR_MIN_INTERVAL_MS   >= 5000 (tech.md rate rule), default 5000
 * - DIRECTOR_RECORDED_LATENCY_MS 0..5000, default 700 (makes the loading state visible)
 * - DIRECTOR_MORPH             "1" or "true" accepts World Morph requests (default off)
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>, overrides: ConfigOverrides = {}): DirectorConfig {
  const rawKey = env.GEMINI_API_KEY?.trim();
  const key = rawKey && rawKey.length > 0 ? rawKey : null;
  const requested = env.DIRECTOR_MODE?.trim().toLowerCase();

  let mode: DirectorMode;
  let modeReason: string;
  if (requested === 'recorded') {
    mode = 'recorded';
    modeReason = 'DIRECTOR_MODE=recorded';
  } else if (requested === 'live') {
    mode = 'live';
    modeReason = key ? 'DIRECTOR_MODE=live' : 'DIRECTOR_MODE=live, but GEMINI_API_KEY is not set';
  } else if (requested && requested.length > 0) {
    mode = 'recorded';
    modeReason = 'DIRECTOR_MODE has an unknown value; using recorded mode';
  } else if (key) {
    mode = 'live';
    modeReason = 'GEMINI_API_KEY is set';
  } else {
    mode = 'recorded';
    modeReason = 'GEMINI_API_KEY is not set';
  }

  const morphFlag = env.DIRECTOR_MORPH?.trim().toLowerCase();
  const morphEnabled = overrides.morphEnabled ?? (morphFlag === '1' || morphFlag === 'true');

  const modelRaw = env.GEMINI_MODEL?.trim();
  const model = modelRaw && MODEL_PATTERN.test(modelRaw) ? modelRaw : DEFAULT_MODEL;

  return Object.freeze({
    mode,
    modeReason,
    model,
    keyConfigured: key !== null,
    timeoutMs: overrides.timeoutMs ?? intFrom(env.DIRECTOR_TIMEOUT_MS, 30_000, 1_000, 60_000),
    minIntervalMs: overrides.minIntervalMs ?? intFrom(env.DIRECTOR_MIN_INTERVAL_MS, 5_000, 5_000, 600_000),
    recordedLatencyMs: overrides.recordedLatencyMs ?? intFrom(env.DIRECTOR_RECORDED_LATENCY_MS, 700, 0, 5_000),
    apiBase: overrides.apiBase ?? GEMINI_API_BASE,
    morphEnabled,
    getApiKey: () => key,
    // Defensive: if anything ever serialises the config, the key is absent.
    toJSON: () => ({ mode, modeReason, model, keyConfigured: key !== null, morphEnabled }),
  } as DirectorConfig & { toJSON(): unknown });
}
