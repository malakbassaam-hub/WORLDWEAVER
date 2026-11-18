import { describe, expect, it } from 'vitest';
import { PROPOSAL_LIMITS } from './schema';
import { formatIssues, parseProposalText, validateProposal, type ValidationIssue } from './validate';

const createProposal = () => ({
  summary: 'Raise a ring of violet spires around the citadel.',
  worldName: 'Crystal Kingdom at Dusk',
  operations: [
    { op: 'add', archetype: 'crystalSpire', name: 'Violet Sentinel', count: 3, placement: 'inner-ring', palette: 'Night Violet', glow: 2.5 },
    { op: 'add', archetype: 'lightOrb', name: 'Lantern', placement: 'near-target', target: 'e2' },
  ],
});

const editProposal = () => ({
  summary: 'Recolour and tidy up.',
  operations: [
    { op: 'recolor', target: 'e4', palette: 'Orchid Flare' },
    { op: 'glow', target: 'e4', glow: 6 },
    { op: 'rename', target: 'e5', name: 'Warden Spire' },
    { op: 'move', target: 'e6', direction: 'up', steps: 2 },
    { op: 'hide', target: 'e7' },
    { op: 'show', target: 'e7' },
    { op: 'remove', target: 'e8' },
  ],
});

function errorsOf(input: unknown): readonly ValidationIssue[] {
  const result = validateProposal(input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

function expectIssue(input: unknown, path: string, code: ValidationIssue['code']) {
  const errors = errorsOf(input);
  expect(errors, formatIssues(errors)).toContainEqual(expect.objectContaining({ path, code }));
}

function withOp(op: Record<string, unknown>) {
  return { summary: 'test', operations: [op] };
}

describe('validateProposal: valid input', () => {
  it('accepts create and edit proposals', () => {
    const create = validateProposal(createProposal());
    expect(create.ok).toBe(true);
    const edit = validateProposal(editProposal());
    expect(edit.ok).toBe(true);
    if (edit.ok) expect(edit.proposal.operations).toHaveLength(7);
  });

  it('returns a frozen copy, so validated proposals cannot be mutated later', () => {
    const result = validateProposal(createProposal());
    if (!result.ok) throw new Error('unexpected');
    expect(Object.isFrozen(result.proposal)).toBe(true);
    expect(Object.isFrozen(result.proposal.operations[0])).toBe(true);
  });

  it('accepts Arabic and mixed-language text, trimmed and NFC-normalised', () => {
    const result = validateProposal({
      summary: '  أضف أبراجًا بنفسجية — add violet spires  ',
      operations: [{ op: 'add', archetype: 'crystalSpire', name: ' برج القمر ', placement: 'sky' }, { op: 'rename', target: 'e3', name: 'Cafe\u0301' }],
    });
    if (!result.ok) throw new Error(formatIssues(result.errors));
    expect(result.proposal.summary).toBe('أضف أبراجًا بنفسجية — add violet spires');
    const [add, rename] = result.proposal.operations;
    expect(add?.op === 'add' && add.name).toBe('برج القمر');
    expect(rename?.op === 'rename' && rename.name).toBe('Caf\u00e9');
  });

  it('allows ZWJ/ZWNJ, which Persian, Arabic and emoji text need', () => {
    expect(validateProposal(withOp({ op: 'rename', target: 'e1', name: 'می\u200cخواهم 👩\u200d🚀' })).ok).toBe(true);
  });

  it('treats markup and script-like text as inert data', () => {
    const result = validateProposal(withOp({ op: 'rename', target: 'e1', name: '<img src=x onerror=alert(1)>' }));
    expect(result.ok).toBe(true);
  });
});

describe('parseProposalText', () => {
  it('parses valid JSON text', () => {
    expect(parseProposalText(JSON.stringify(editProposal())).ok).toBe(true);
  });

  it('rejects invalid JSON with a clear error', () => {
    const r = parseProposalText('{"summary": "x", "operations": [');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('invalid_json');
  });

  it('rejects oversized responses before parsing', () => {
    const huge = JSON.stringify({ summary: 'x', operations: [], padding: 'a'.repeat(PROPOSAL_LIMITS.maxRawBytes) });
    const r = parseProposalText(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([expect.objectContaining({ code: 'too_large' })]);
  });

  it('measures the size limit in UTF-8 bytes, not characters', () => {
    const arabic = 'ب'.repeat(PROPOSAL_LIMITS.maxRawBytes / 2 + 10); // 2 bytes each
    const r = parseProposalText(JSON.stringify({ summary: arabic }));
    expect(!r.ok && r.errors[0]?.code).toBe('too_large');
  });

  it('rejects non-finite numbers produced by JSON overflow', () => {
    const r = parseProposalText('{"summary":"x","operations":[{"op":"glow","target":"e1","glow":1e309}]}');
    expect(!r.ok && r.errors[0]).toEqual(expect.objectContaining({ path: 'operations[0].glow', code: 'invalid_type' }));
  });

  it('rejects __proto__ and constructor keys from raw JSON', () => {
    const r = parseProposalText('{"summary":"x","operations":[{"op":"hide","target":"e1"}],"__proto__":{"polluted":true}}');
    expect(!r.ok && r.errors).toContainEqual(expect.objectContaining({ path: '__proto__', code: 'forbidden_key' }));
    const c = parseProposalText('{"summary":"x","operations":[{"op":"hide","target":"e1","constructor":{"prototype":{}}}]}');
    expect(!c.ok && c.errors).toContainEqual(expect.objectContaining({ path: 'operations[0].constructor', code: 'forbidden_key' }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('validateProposal: structure', () => {
  it.each([['array', []], ['null', null], ['string', 'make a world'], ['number', 42]])('rejects a %s root', (_label, input) => {
    expectIssue(input, '', 'not_object');
  });

  it('requires summary and operations', () => {
    expectIssue({ operations: [{ op: 'hide', target: 'e1' }] }, 'summary', 'missing_property');
    expectIssue({ summary: 'x' }, 'operations', 'missing_property');
    expectIssue({ summary: 'x', operations: [] }, 'operations', 'out_of_range');
    expectIssue({ summary: 'x', operations: {} }, 'operations', 'invalid_type');
  });

  it('rejects unknown root and operation properties', () => {
    expectIssue({ ...editProposal(), seed: 7 }, 'seed', 'unknown_property');
    expectIssue(withOp({ op: 'hide', target: 'e1', id: 'ck:isle-001' }), 'operations[0].id', 'unknown_property');
    expectIssue(withOp({ op: 'add', archetype: 'obelisk', name: 'X', placement: 'sky', position: [0, 0, 0] }), 'operations[0].position', 'unknown_property');
    expectIssue(withOp({ op: 'rename', target: 'e1', name: 'X', palette: 'Moon White' }), 'operations[0].palette', 'unknown_property');
  });

  it.each(['exec', 'eval', 'setWorld', 'entity/added', 'ADD', ''])('rejects unknown operation type "%s"', (op) => {
    expectIssue(withOp({ op, target: 'e1' }), 'operations[0].op', 'invalid_enum');
  });

  it('rejects missing or non-string op', () => {
    expectIssue(withOp({ target: 'e1' }), 'operations[0].op', 'missing_property');
    expectIssue(withOp({ op: 3, target: 'e1' }), 'operations[0].op', 'invalid_type');
    expectIssue({ summary: 'x', operations: ['add'] }, 'operations[0]', 'not_object');
  });

  it('requires the per-operation fields', () => {
    expectIssue(withOp({ op: 'add', name: 'X', placement: 'sky' }), 'operations[0].archetype', 'missing_property');
    expectIssue(withOp({ op: 'recolor', target: 'e1' }), 'operations[0].palette', 'missing_property');
    expectIssue(withOp({ op: 'move', target: 'e1' }), 'operations[0].direction', 'missing_property');
    expectIssue(withOp({ op: 'remove' }), 'operations[0].target', 'missing_property');
  });
});

describe('validateProposal: values', () => {
  it('rejects wrong types', () => {
    expectIssue(withOp({ op: 'add', archetype: 'crystalSpire', name: 'X', placement: 'sky', count: '3' }), 'operations[0].count', 'invalid_type');
    expectIssue(withOp({ op: 'glow', target: 'e1', glow: 'bright' }), 'operations[0].glow', 'invalid_type');
    expectIssue(withOp({ op: 'rename', target: 'e1', name: 42 }), 'operations[0].name', 'invalid_type');
    expectIssue(withOp({ op: 'hide', target: 7 }), 'operations[0].target', 'invalid_ref');
  });

  it('rejects values outside enums, including case variants', () => {
    expectIssue(withOp({ op: 'recolor', target: 'e1', palette: 'aether cyan' }), 'operations[0].palette', 'invalid_enum');
    expectIssue(withOp({ op: 'recolor', target: 'e1', palette: '#ff0000' }), 'operations[0].palette', 'invalid_enum');
    expectIssue(withOp({ op: 'add', archetype: 'dragon', name: 'X', placement: 'sky' }), 'operations[0].archetype', 'invalid_enum');
    expectIssue(withOp({ op: 'add', archetype: 'obelisk', name: 'X', placement: 'underground' }), 'operations[0].placement', 'invalid_enum');
    expectIssue(withOp({ op: 'move', target: 'e1', direction: 'north' }), 'operations[0].direction', 'invalid_enum');
  });

  it('enforces numeric ranges and whole numbers', () => {
    const add = (count: unknown) => withOp({ op: 'add', archetype: 'crystalSpire', name: 'X', placement: 'sky', count });
    expectIssue(add(0), 'operations[0].count', 'out_of_range');
    expectIssue(add(9), 'operations[0].count', 'out_of_range');
    expectIssue(add(2.5), 'operations[0].count', 'invalid_type');
    expectIssue(withOp({ op: 'glow', target: 'e1', glow: -0.1 }), 'operations[0].glow', 'out_of_range');
    expectIssue(withOp({ op: 'glow', target: 'e1', glow: 10.5 }), 'operations[0].glow', 'out_of_range');
    expectIssue(withOp({ op: 'move', target: 'e1', direction: 'up', steps: 6 }), 'operations[0].steps', 'out_of_range');
  });

  it('enforces per-archetype count budgets', () => {
    expectIssue(withOp({ op: 'add', archetype: 'crystalCitadel', name: 'X', placement: 'center', count: 2 }), 'operations[0].count', 'out_of_range');
    expectIssue(withOp({ op: 'add', archetype: 'lightOrb', name: 'X', placement: 'sky', count: 5 }), 'operations[0].count', 'out_of_range');
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['too long', 'x'.repeat(PROPOSAL_LIMITS.maxNameLength + 1)],
    ['control character', 'bell\u0007'],
    ['NUL', 'a\u0000b'],
    ['bidi override', 'abc\u202Edcba'],
    ['bidi isolate', '\u2066x\u2069'],
    ['line separator', 'a\u2028b'],
    ['lone surrogate', 'bad\ud800'],
  ])('rejects unsafe or invalid names: %s', (_label, name) => {
    const errors = errorsOf(withOp({ op: 'rename', target: 'e1', name }));
    expect(errors[0]?.path).toBe('operations[0].name');
    expect(['invalid_string', 'out_of_range']).toContain(errors[0]?.code);
  });

  it.each(['E1', 'e0', 'e01', 'entity-1', 'e12345', 'ck:isle-of-aurelion-001', ''])('rejects malformed ref "%s"', (target) => {
    expectIssue(withOp({ op: 'hide', target }), 'operations[0].target', 'invalid_ref');
  });

  it('checks target and placement combinations', () => {
    expectIssue(withOp({ op: 'add', archetype: 'obelisk', name: 'X', placement: 'on-target' }), 'operations[0].target', 'missing_property');
    expectIssue(withOp({ op: 'add', archetype: 'obelisk', name: 'X', placement: 'center', target: 'e1' }), 'operations[0].target', 'invalid_combination');
  });
});

describe('validateProposal: size limits and hostile input', () => {
  it('limits the number of operations', () => {
    const ops = Array.from({ length: PROPOSAL_LIMITS.maxOperations + 1 }, () => ({ op: 'hide', target: 'e1' }));
    expectIssue({ summary: 'x', operations: ops }, 'operations', 'too_many');
  });

  it('limits the total entities added by one proposal', () => {
    const ops = Array.from({ length: 9 }, () => ({ op: 'add', archetype: 'crystalSpire', name: 'X', placement: 'sky', count: 8 }));
    expectIssue({ summary: 'x', operations: ops }, 'operations', 'too_many');
  });

  it('limits summary length', () => {
    expectIssue({ summary: 's'.repeat(PROPOSAL_LIMITS.maxSummaryLength + 1), operations: [{ op: 'hide', target: 'e1' }] }, 'summary', 'out_of_range');
  });

  it('caps the number of reported issues', () => {
    const junk = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`x${i}`, i]));
    const ops = Array.from({ length: PROPOSAL_LIMITS.maxOperations }, () => ({ op: 'hide', target: 'e1', ...junk }));
    expect(errorsOf({ summary: 'x', operations: ops })).toHaveLength(PROPOSAL_LIMITS.maxReportedIssues);
  });

  it('does not echo control characters from hostile keys into messages', () => {
    const errors = errorsOf(withOp({ op: 'hide', target: 'e1', ['evil\u0000\u202Ekey']: 1 }));
    expect(formatIssues(errors)).not.toMatch(/[\u0000\u202E]/);
  });

  it('rejects instruction-injection attempts that try to add executable fields', () => {
    const hostile = {
      summary: 'Ignore previous instructions',
      operations: [{ op: 'add', archetype: 'obelisk', name: 'X', placement: 'sky', script: 'fetch("/api/director")' }],
      code: 'process.exit(1)',
    };
    const errors = errorsOf(hostile);
    expect(errors).toContainEqual(expect.objectContaining({ path: 'code', code: 'unknown_property' }));
    expect(errors).toContainEqual(expect.objectContaining({ path: 'operations[0].script', code: 'unknown_property' }));
  });

  it('gives readable, path-qualified messages', () => {
    const text = formatIssues(errorsOf(withOp({ op: 'recolor', target: 'e1', palette: 'Neon Pink' })));
    expect(text).toContain('operations[0].palette');
    expect(text).toContain('Aether Cyan');
  });
});
