import { describe, expect, it } from 'vitest';
import { LUMINOUS_PALETTE } from '../core/palette';
import { NAME_MAX_LENGTH } from '../core/reducer';
import { ARCHETYPES as RENDER_ARCHETYPES } from '../render/archetypes';
import { LUMINOUS_PALETTE as INSPECTOR_PALETTE } from '../ui/inspector';
import {
  ARCHETYPE_DEFAULTS,
  ARCHETYPES,
  DIRECTIONS,
  OPERATION_KEYS,
  OPERATION_TYPES,
  PALETTE_NAMES,
  PLACEMENTS,
  PROPOSAL_LIMITS,
  PROPOSAL_RESPONSE_SCHEMA,
} from './schema';

describe('proposal schema', () => {
  it('only offers archetypes the renderer can build', () => {
    expect([...ARCHETYPES].sort()).toEqual(Object.keys(RENDER_ARCHETYPES).sort());
  });

  it('uses the shared Luminous palette, unchanged for the inspector', () => {
    expect(PALETTE_NAMES).toEqual(LUMINOUS_PALETTE.map((p) => p.name));
    expect(INSPECTOR_PALETTE).toBe(LUMINOUS_PALETTE);
  });

  it('keeps the Gemini responseSchema enums in sync with the validator', () => {
    const item = PROPOSAL_RESPONSE_SCHEMA.properties.operations.items.properties;
    expect(item.op.enum).toEqual([...OPERATION_TYPES]);
    expect(item.archetype.enum).toEqual([...ARCHETYPES]);
    expect(item.placement.enum).toEqual([...PLACEMENTS]);
    expect(item.palette.enum).toEqual([...PALETTE_NAMES]);
    expect(item.direction.enum).toEqual([...DIRECTIONS]);
    expect(JSON.parse(JSON.stringify(PROPOSAL_RESPONSE_SCHEMA))).toEqual(PROPOSAL_RESPONSE_SCHEMA);
  });

  it('defines keys for every operation and only schema-known keys', () => {
    const known = new Set(Object.keys(PROPOSAL_RESPONSE_SCHEMA.properties.operations.items.properties));
    for (const type of OPERATION_TYPES) {
      const spec = OPERATION_KEYS[type];
      expect(spec.required).toContain('op');
      for (const key of [...spec.required, ...spec.optional]) expect(known.has(key)).toBe(true);
    }
  });

  it('has archetype defaults that satisfy reducer and budget limits', () => {
    for (const archetype of ARCHETYPES) {
      const d = ARCHETYPE_DEFAULTS[archetype];
      expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(d.emissive).toMatch(/^#[0-9a-f]{6}$/);
      expect(d.scale.every((s) => s > 0)).toBe(true);
      expect(d.maxCount).toBeGreaterThanOrEqual(1);
      expect(d.maxCount).toBeLessThanOrEqual(PROPOSAL_LIMITS.maxAddCount);
    }
    expect(PROPOSAL_LIMITS.maxNameLength).toBe(NAME_MAX_LENGTH);
  });
});
