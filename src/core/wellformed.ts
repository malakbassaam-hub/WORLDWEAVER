/**
 * Structural checks for records that may come from outside the running
 * session (a reloaded log, a stored ledger, a future's step list).
 *
 * The reducer validates the MEANING of a well-formed event and never throws
 * for bad values, but it assumes the TypeScript shape (for example that
 * `entity/added` carries an `entity` object). These checks reject anything
 * that is not shaped like a WorldEvent or LogEntry before it reaches the
 * reducer, so malformed input can never throw inside replay or corrupt state.
 */
import type { LogEntry } from './store';
import type { WorldEvent } from './types';

const SOURCES = new Set(['system', 'user', 'director']);
const LOG_KINDS = new Set(['event', 'batch', 'undo', 'redo']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');

function checkTransform(t: unknown, partial: boolean): string | null {
  if (!isObj(t)) return 'transform must be an object';
  for (const key of ['position', 'rotation', 'scale']) {
    if (t[key] === undefined && partial) continue;
    if (!isVec(t[key])) return `transform.${key} must be three numbers`;
  }
  for (const key of Object.keys(t)) if (!['position', 'rotation', 'scale'].includes(key)) return `unknown transform field "${key}"`;
  return null;
}

function checkVisualPatch(p: unknown, full: boolean): string | null {
  if (!isObj(p)) return 'visual must be an object';
  const fields: Record<string, (v: unknown) => boolean> = {
    color: isStr,
    emissive: isStr,
    emissiveIntensity: (v) => typeof v === 'number',
    visible: (v) => typeof v === 'boolean',
    ...(full ? { archetype: isStr } : {}),
  };
  for (const [key, ok] of Object.entries(fields)) {
    if (p[key] === undefined && !full) continue;
    if (!ok(p[key])) return `visual.${key} has the wrong type`;
  }
  for (const key of Object.keys(p)) if (!(key in fields)) return `unknown visual field "${key}"`;
  return null;
}

/** Returns null if `value` is shaped like a WorldEvent, otherwise the first problem. */
export function checkEventShape(value: unknown): string | null {
  if (!isObj(value)) return 'event must be an object';
  if (!isStr(value.source) || !SOURCES.has(value.source)) return 'event source must be system, user or director';
  if (value.note !== undefined && !isStr(value.note)) return 'event note must be text';
  switch (value.type) {
    case 'entity/added': {
      const d = value.entity;
      if (!isObj(d)) return 'entity/added needs an entity object';
      if (!isStr(d.id) || !isStr(d.name) || !isStr(d.kind)) return 'entity id, name and kind must be text';
      if (d.parentId !== null && !isStr(d.parentId)) return 'entity parentId must be text or null';
      if (!Array.isArray(d.tags) || !d.tags.every(isStr)) return 'entity tags must be a list of text';
      if (typeof d.pinned !== 'boolean') return 'entity pinned must be true or false';
      if (!isObj(d.components)) return 'entity components must be an object';
      const t = checkTransform(d.components.transform, false);
      if (t) return t;
      if (d.components.visual !== undefined) {
        const v = checkVisualPatch(d.components.visual, true);
        if (v) return v;
      }
      if (d.components.light !== undefined) {
        const l = d.components.light;
        if (!isObj(l) || !isStr(l.color) || typeof l.intensity !== 'number' || typeof l.range !== 'number') return 'light must have color, intensity and range';
      }
      return null;
    }
    case 'entity/removed':
      return isStr(value.id) ? null : 'event id must be text';
    case 'entity/renamed':
      return isStr(value.id) && isStr(value.name) ? null : 'rename needs text id and name';
    case 'entity/transformed':
      return isStr(value.id) ? checkTransform(value.transform, true) : 'event id must be text';
    case 'entity/visualChanged':
      return isStr(value.id) ? checkVisualPatch(value.patch, false) : 'event id must be text';
    case 'entity/pinnedChanged':
      return isStr(value.id) && typeof value.pinned === 'boolean' ? null : 'pin change needs text id and true/false';
    default:
      return `unknown event type "${String(value.type)}"`;
  }
}

export const isWorldEvent = (value: unknown): value is WorldEvent => checkEventShape(value) === null;

/** Returns null if `value` is shaped like a LogEntry, otherwise the first problem. */
export function checkLogEntryShape(value: unknown): string | null {
  if (!isObj(value)) return 'log entry must be an object';
  if (!isStr(value.kind) || !LOG_KINDS.has(value.kind)) return `unknown log entry kind "${String(value.kind)}"`;
  if (typeof value.ok !== 'boolean') return 'log entry ok must be true or false';
  if (value.kind === 'event') {
    const p = checkEventShape(value.event);
    return p ? `event: ${p}` : null;
  }
  if (value.kind === 'batch') {
    if (!Array.isArray(value.events)) return 'batch events must be a list';
    for (let i = 0; i < value.events.length; i++) {
      const p = checkEventShape(value.events[i]);
      if (p) return `batch event ${i + 1}: ${p}`;
    }
    const m = value.meta;
    if (!isObj(m) || !isStr(m.label) || !isStr(m.source) || !SOURCES.has(m.source)) return 'batch meta needs a label and a valid source';
    if (m.details !== undefined && (!isObj(m.details) || !Object.values(m.details).every(isStr))) return 'batch details must map text to text';
  }
  return null;
}

export const isLogEntry = (value: unknown): value is LogEntry => checkLogEntryShape(value) === null;
