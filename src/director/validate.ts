/**
 * Strict runtime validation for model output. Model output is untrusted data:
 * it is parsed with JSON.parse only, never evaluated, and every field is
 * checked against the v2 schema. Anything unexpected is rejected, not repaired.
 */
import {
  ARCHETYPE_DEFAULTS,
  ARCHETYPES,
  DIRECTIONS,
  OPERATION_KEYS,
  OPERATION_TYPES,
  PALETTE_NAMES,
  PLACEMENTS,
  PROPOSAL_KEYS,
  PROPOSAL_LIMITS as L,
  REF_PATTERN,
  TARGETED_PLACEMENTS,
  type OperationType,
  type ProposalOperation,
  type WorldProposal,
} from './schema';

export type IssueCode =
  | 'too_large'
  | 'invalid_json'
  | 'not_object'
  | 'forbidden_key'
  | 'unknown_property'
  | 'missing_property'
  | 'invalid_type'
  | 'invalid_enum'
  | 'out_of_range'
  | 'invalid_string'
  | 'invalid_ref'
  | 'invalid_combination'
  | 'too_many';

export interface ValidationIssue {
  /** JSON path, e.g. `operations[3].palette`. */
  readonly path: string;
  readonly code: IssueCode;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly proposal: WorldProposal }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

/** Keys that could reach Object.prototype through careless code elsewhere. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Characters rejected in any text: C0/C1 controls, bidi embedding/override
 * and isolate controls (spoofing), BOM, and line/paragraph separators.
 * ZWJ/ZWNJ stay allowed because Arabic, Persian and emoji text need them.
 */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Parses raw model text and validates it. Size is checked before parsing. */
export function parseProposalText(text: string): ValidationResult {
  if (typeof text !== 'string') return fail('', 'invalid_type', 'Response must be text.');
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > L.maxRawBytes) {
    return fail('', 'too_large', `Response is ${bytes} bytes; the limit is ${L.maxRawBytes}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail('', 'invalid_json', `Response is not valid JSON: ${(error as Error).message}`);
  }
  return validateProposal(parsed);
}

/** Validates an already-parsed value. Returns a normalised, frozen proposal. */
export function validateProposal(input: unknown): ValidationResult {
  const v = new Validator();
  const proposal = v.proposal(input);
  if (v.issues.length > 0 || !proposal) return { ok: false, errors: v.issues };
  return { ok: true, proposal: deepFreeze(proposal) };
}

/** Human-readable multi-line summary of validation errors. */
export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n');
}

// ---------------------------------------------------------------- implementation

class Validator {
  readonly issues: ValidationIssue[] = [];

  add(path: string, code: IssueCode, message: string): void {
    if (this.issues.length < L.maxReportedIssues) this.issues.push({ path, code, message });
  }

  proposal(input: unknown): WorldProposal | null {
    const obj = this.object(input, '');
    if (!obj) return null;
    this.keys(obj, '', PROPOSAL_KEYS.required, PROPOSAL_KEYS.optional);

    const summary = this.text(obj.summary, 'summary', L.maxSummaryLength, true);
    const worldName = obj.worldName === undefined ? undefined : this.text(obj.worldName, 'worldName', L.maxNameLength, true);
    const biome = obj.biome === undefined ? undefined : this.text(obj.biome, 'biome', L.maxTextLength, true);

    const operations: ProposalOperation[] = [];
    if (obj.operations !== undefined) {
      if (!Array.isArray(obj.operations)) {
        this.add('operations', 'invalid_type', 'operations must be an array.');
      } else if (obj.operations.length === 0) {
        this.add('operations', 'out_of_range', 'operations must contain at least one operation.');
      } else if (obj.operations.length > L.maxOperations) {
        this.add('operations', 'too_many', `operations has ${obj.operations.length} items; the limit is ${L.maxOperations}.`);
      } else {
        obj.operations.forEach((raw, i) => {
          const op = this.operation(raw, `operations[${i}]`);
          if (op) operations.push(op);
        });
        const added = operations.reduce((n, op) => n + (op.op === 'add' ? (op.count ?? 1) : 0), 0);
        if (added > L.maxAddedPerProposal) {
          this.add('operations', 'too_many', `Proposal adds ${added} entities; the limit is ${L.maxAddedPerProposal}.`);
        }
      }
    }

    if (summary === null || this.issues.length > 0) return null;
    return {
      summary,
      ...(worldName ? { worldName } : {}),
      ...(biome ? { biome } : {}),
      operations,
    };
  }

  operation(raw: unknown, path: string): ProposalOperation | null {
    const obj = this.object(raw, path);
    if (!obj) return null;
    const type = obj.op;
    if (typeof type !== 'string') {
      this.add(`${path}.op`, type === undefined ? 'missing_property' : 'invalid_type', 'op must be one of: ' + OPERATION_TYPES.join(', ') + '.');
      return null;
    }
    if (!(OPERATION_TYPES as readonly string[]).includes(type)) {
      this.add(`${path}.op`, 'invalid_enum', `Unknown operation "${clip(type)}". Allowed: ${OPERATION_TYPES.join(', ')}.`);
      return null;
    }
    const opType = type as OperationType;
    const spec = OPERATION_KEYS[opType];
    const before = this.issues.length;
    this.keys(obj, path, spec.required, spec.optional);

    const target = spec.required.includes('target') || obj.target !== undefined ? this.ref(obj.target, `${path}.target`, spec.required.includes('target')) : undefined;

    let result: ProposalOperation | null = null;
    switch (opType) {
      case 'add': {
        const archetype = this.enumValue(obj.archetype, `${path}.archetype`, ARCHETYPES);
        const name = this.text(obj.name, `${path}.name`, L.maxNameLength, true);
        const placement = this.enumValue(obj.placement, `${path}.placement`, PLACEMENTS);
        const count = obj.count === undefined ? undefined : this.integer(obj.count, `${path}.count`, 1, L.maxAddCount);
        const palette = obj.palette === undefined ? undefined : this.enumValue(obj.palette, `${path}.palette`, PALETTE_NAMES);
        const glow = obj.glow === undefined ? undefined : this.number(obj.glow, `${path}.glow`, L.minGlow, L.maxGlow);
        if (placement && TARGETED_PLACEMENTS.has(placement) && obj.target === undefined) {
          this.add(`${path}.target`, 'missing_property', `placement "${placement}" requires a target.`);
        }
        if (placement && !TARGETED_PLACEMENTS.has(placement) && obj.target !== undefined) {
          this.add(`${path}.target`, 'invalid_combination', `target is only allowed with placement "on-target" or "near-target".`);
        }
        if (archetype && count !== undefined && count !== null && count > ARCHETYPE_DEFAULTS[archetype].maxCount) {
          this.add(`${path}.count`, 'out_of_range', `At most ${ARCHETYPE_DEFAULTS[archetype].maxCount} ${archetype} per operation.`);
        }
        if (archetype && name !== null && placement && count !== null && palette !== null && glow !== null) {
          result = {
            op: 'add',
            archetype,
            name,
            placement,
            ...(count !== undefined ? { count } : {}),
            ...(target ? { target } : {}),
            ...(palette !== undefined ? { palette } : {}),
            ...(glow !== undefined ? { glow } : {}),
          };
        }
        break;
      }
      case 'rename': {
        const name = this.text(obj.name, `${path}.name`, L.maxNameLength, true);
        if (target && name !== null) result = { op: 'rename', target, name };
        break;
      }
      case 'recolor': {
        const palette = this.enumValue(obj.palette, `${path}.palette`, PALETTE_NAMES);
        if (target && palette) result = { op: 'recolor', target, palette };
        break;
      }
      case 'glow': {
        const glow = this.number(obj.glow, `${path}.glow`, L.minGlow, L.maxGlow);
        if (target && glow !== null) result = { op: 'glow', target, glow };
        break;
      }
      case 'move': {
        const direction = this.enumValue(obj.direction, `${path}.direction`, DIRECTIONS);
        const steps = obj.steps === undefined ? undefined : this.integer(obj.steps, `${path}.steps`, 1, L.maxMoveSteps);
        if (target && direction && steps !== null) result = { op: 'move', target, direction, ...(steps !== undefined ? { steps } : {}) };
        break;
      }
      case 'remove':
      case 'show':
      case 'hide': {
        if (target) result = { op: opType, target };
        break;
      }
    }
    return this.issues.length === before ? result : null;
  }

  // ------------------------------------------------------------- primitives

  object(value: unknown, path: string): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.add(path, 'not_object', `${path || 'Response'} must be a JSON object.`);
      return null;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      this.add(path, 'not_object', `${path || 'Response'} must be a plain JSON object.`);
      return null;
    }
    return value as Record<string, unknown>;
  }

  keys(obj: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[]): void {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(obj)) {
      const at = path ? `${path}.${clip(key)}` : clip(key);
      if (FORBIDDEN_KEYS.has(key)) this.add(at, 'forbidden_key', `Property "${clip(key)}" is not allowed.`);
      else if (!allowed.has(key)) this.add(at, 'unknown_property', `Unknown property "${clip(key)}".`);
    }
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        this.add(path ? `${path}.${key}` : key, 'missing_property', `Missing required property "${key}".`);
      }
    }
  }

  /** Returns trimmed NFC text, or null after recording an issue. */
  text(value: unknown, path: string, max: number, required: boolean): string | null {
    if (value === undefined) {
      if (required) this.add(path, 'missing_property', 'Missing required text.');
      return null;
    }
    if (typeof value !== 'string') {
      this.add(path, 'invalid_type', 'Must be text.');
      return null;
    }
    if (LONE_SURROGATE.test(value)) {
      this.add(path, 'invalid_string', 'Contains malformed Unicode.');
      return null;
    }
    if (UNSAFE_CHARS.test(value)) {
      this.add(path, 'invalid_string', 'Contains control or bidirectional-override characters.');
      return null;
    }
    const clean = value.normalize('NFC').trim();
    if (clean.length === 0) {
      this.add(path, 'invalid_string', 'Must not be empty.');
      return null;
    }
    if (clean.length > max) {
      this.add(path, 'out_of_range', `Must be at most ${max} characters (got ${clean.length}).`);
      return null;
    }
    return clean;
  }

  ref(value: unknown, path: string, required: boolean): string | null | undefined {
    if (value === undefined) {
      if (required) this.add(path, 'missing_property', 'Missing required target.');
      return required ? null : undefined;
    }
    if (typeof value !== 'string' || !REF_PATTERN.test(value)) {
      this.add(path, 'invalid_ref', 'target must be an entity ref like "e7".');
      return null;
    }
    return value;
  }

  enumValue<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
    if (value === undefined) {
      this.add(path, 'missing_property', `Missing required value. Allowed: ${allowed.join(', ')}.`);
      return null;
    }
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.add(path, 'invalid_enum', `"${clip(String(value))}" is not allowed. Allowed: ${allowed.join(', ')}.`);
      return null;
    }
    return value as T;
  }

  number(value: unknown, path: string, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(path, 'invalid_type', 'Must be a finite number.');
      return null;
    }
    if (value < min || value > max) {
      this.add(path, 'out_of_range', `Must be between ${min} and ${max} (got ${value}).`);
      return null;
    }
    return value;
  }

  integer(value: unknown, path: string, min: number, max: number): number | null {
    const n = this.number(value, path, min, max);
    if (n !== null && !Number.isInteger(n)) {
      this.add(path, 'invalid_type', 'Must be a whole number.');
      return null;
    }
    return n;
  }
}

function fail(path: string, code: IssueCode, message: string): ValidationResult {
  return { ok: false, errors: [{ path, code, message }] };
}

/** Keeps echoed model text short and free of unsafe characters in messages. */
function clip(text: string): string {
  const safe = text.replace(new RegExp(UNSAFE_CHARS.source, 'g'), '?').replace(new RegExp(LONE_SURROGATE.source, 'g'), '?');
  return safe.length > 40 ? `${safe.slice(0, 40)}…` : safe;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
