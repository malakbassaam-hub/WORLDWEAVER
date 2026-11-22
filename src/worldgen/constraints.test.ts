import { describe, expect, it } from 'vitest';
import { expandRequirements } from './constraints';
import { interpretPrompt } from './interpret';

const spec = (prompt: string) => expandRequirements(interpretPrompt(prompt));

describe('expandRequirements', () => {
  it('a waterfall implies a river and a cliff', () => {
    const s = spec('a waterfall');
    expect(s.waterfalls).toBe(1);
    expect(s.rivers).toBe(1);
    expect(s.cliffs).toBe(1);
    expect(s.constraints.some((c) => c.kind === 'imply' && c.subject === 'waterfall')).toBe(true);
  });

  it('a waterfall with "no river" is a reported conflict, not a silent river', () => {
    const s = spec('a waterfall but no river');
    expect(s.rivers).toBe(0);
    expect(s.waterfalls).toBe(0);
    expect(s.conflicts.some((c) => c.includes('waterfall'))).toBe(true);
  });

  it('a bridge implies something to cross', () => {
    const s = spec('a bridge');
    expect(s.bridges).toBe(1);
    expect(s.rivers).toBe(1);
  });

  it('a lighthouse implies open water', () => {
    const s = spec('a lighthouse on a hill');
    expect(s.needsWater).toBe(true);
    expect(s.sea).toBe(true);
    expect(s.hero).toBe('lighthouse');
  });

  it('respects negation of default features', () => {
    const s = spec('a desert temple with no river');
    expect(s.rivers).toBe(0);
    expect(spec('a tower, no river, no lake').rivers).toBe(0);
  });

  it('chooses the hero by landmark priority and defaults it by biome', () => {
    expect(spec('a tower and a castle').hero).toBe('castle');
    const d = spec('a desert with dunes');
    expect(d.hero).toBe('temple');
    expect(d.heroDefaulted).toBe(true);
  });

  it('turns houses or characters into a settlement', () => {
    expect(spec('five houses').settlements).toBe(1);
    expect(spec('five houses').houses).toBe(5);
    expect(spec('a villager').settlements).toBe(1);
    expect(spec('two villages').settlements).toBe(2);
  });

  it('is deterministic', () => {
    expect(spec('A castle on a mountain with a forest')).toEqual(spec('A castle on a mountain with a forest'));
  });
});
