import { applyEvent, createEmptyWorld } from '../core/reducer';
import { createIdFactory, createRng } from '../core/random';
import type { ColorHex, EntityDraft, EntityId, Vec3, World, WorldEvent } from '../core/types';

/**
 * "Crystal Kingdom at Dusk" — the Phase 1 showcase world.
 *
 * The world is pure data generated deterministically from a seed. Every
 * entity is created through an `entity/added` event with source 'system',
 * so the result is replayable and carries provenance like any other change.
 */
export const CRYSTAL_KINGDOM_SEED = 20261031;

interface DraftInput {
  id: EntityId;
  name: string;
  kind: string;
  archetype: string;
  parentId?: EntityId | null;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  color: ColorHex;
  emissive: ColorHex;
  emissiveIntensity: number;
  tags?: string[];
  pinned?: boolean;
  light?: { color: ColorHex; intensity: number; range: number };
}

function draft(input: DraftInput): EntityDraft {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    parentId: input.parentId ?? null,
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    components: {
      transform: {
        position: input.position,
        rotation: input.rotation ?? [0, 0, 0],
        scale: input.scale ?? [1, 1, 1],
      },
      visual: {
        archetype: input.archetype,
        color: input.color,
        emissive: input.emissive,
        emissiveIntensity: input.emissiveIntensity,
        visible: true,
      },
      ...(input.light ? { light: input.light } : {}),
    },
  };
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** Returns the ordered genesis events for the Crystal Kingdom. */
export function crystalKingdomEvents(seed: number = CRYSTAL_KINGDOM_SEED): WorldEvent[] {
  const rng = createRng(seed);
  const id = createIdFactory('ck');
  const drafts: EntityDraft[] = [];
  const add = (input: DraftInput) => {
    drafts.push(draft(input));
    return input.id;
  };

  // --- Heart of the kingdom -------------------------------------------------
  const mainIsle = add({
    id: id('isle-of-aurelion'),
    name: 'Isle of Aurelion',
    kind: 'island',
    archetype: 'floatingIsland',
    position: [0, 0, 0],
    scale: [15, 11, 15],
    color: '#3b3566',
    emissive: '#2a1f5c',
    emissiveIntensity: 0.15,
    tags: ['terrain', 'floating'],
  });

  const citadel = add({
    id: id('aurelion-citadel'),
    name: 'Aurelion Citadel',
    kind: 'structure',
    archetype: 'crystalCitadel',
    parentId: mainIsle,
    position: [0, 0, 0],
    color: '#7fe8ff',
    emissive: '#38d9ff',
    emissiveIntensity: 2.4,
    tags: ['landmark', 'focal-point'],
    pinned: true,
  });

  add({
    id: id('celestial-halo'),
    name: 'Celestial Halo',
    kind: 'structure',
    archetype: 'arcaneRing',
    parentId: citadel,
    position: [0, 21, 0],
    rotation: [0.32, 0, 0.12],
    color: '#c9a6ff',
    emissive: '#a970ff',
    emissiveIntensity: 3.2,
    tags: ['arcane'],
  });

  // Ring of sentinel spires around the citadel.
  const sentinelCount = 6;
  for (let i = 0; i < sentinelCount; i++) {
    const angle = (i / sentinelCount) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const radius = rng.range(8.2, 9.6);
    const height = rng.range(0.75, 1.25);
    const violet = i % 2 === 1;
    add({
      id: id(`sentinel-spire-${i + 1}`),
      name: `Sentinel Spire ${ROMAN[i] ?? String(i + 1)}`,
      kind: 'crystal',
      archetype: 'crystalSpire',
      parentId: mainIsle,
      position: [round(Math.cos(angle) * radius), 0, round(Math.sin(angle) * radius)],
      rotation: [round(rng.range(-0.08, 0.08)), round(rng.range(0, Math.PI)), round(rng.range(-0.08, 0.08))],
      scale: [round(height), round(height * rng.range(0.9, 1.2)), round(height)],
      color: violet ? '#b48cff' : '#7fe8ff',
      emissive: violet ? '#8b5cff' : '#2fd4ff',
      emissiveIntensity: 1.8,
      tags: ['crystal'],
    });
  }

  // --- Satellite islands -----------------------------------------------------
  const satellites = [
    { name: 'Veilstone Reach', angle: 0.55, dist: 31, y: 5 },
    { name: 'Emberglass Rest', angle: 2.25, dist: 27, y: -3.5 },
    { name: 'Hollow of Whispers', angle: 3.7, dist: 34, y: 8.5 },
    { name: 'Moonshard Cay', angle: 5.1, dist: 25, y: -1 },
  ];
  satellites.forEach((s, index) => {
    const angle = s.angle + rng.range(-0.15, 0.15);
    const size = rng.range(4.2, 6.2);
    const isleId = add({
      id: id(s.name),
      name: s.name,
      kind: 'island',
      archetype: 'floatingIsland',
      position: [round(Math.cos(angle) * s.dist), round(s.y), round(Math.sin(angle) * s.dist)],
      rotation: [0, round(rng.range(0, Math.PI * 2)), 0],
      scale: [round(size), round(size * 0.85), round(size)],
      color: '#352f5c',
      emissive: '#24194f',
      emissiveIntensity: 0.12,
      tags: ['terrain', 'floating'],
    });
    const clusters = 1 + (index % 2);
    for (let c = 0; c < clusters; c++) {
      const a = rng.range(0, Math.PI * 2);
      const r = c === 0 ? 0 : size * 0.45;
      const violet = (index + c) % 2 === 0;
      add({
        id: id(`${s.name}-cluster-${c + 1}`),
        name: `${s.name.split(' ')[0]} Cluster ${ROMAN[c] ?? String(c + 1)}`,
        kind: 'crystal',
        archetype: 'crystalCluster',
        parentId: isleId,
        position: [round(Math.cos(a) * r), 0, round(Math.sin(a) * r)],
        rotation: [0, round(rng.range(0, Math.PI * 2)), 0],
        scale: [round(size * 0.32), round(size * 0.36), round(size * 0.32)],
        color: violet ? '#c39bff' : '#8cf0ff',
        emissive: violet ? '#9a5cff' : '#30d8ff',
        emissiveIntensity: 1.6,
        tags: ['crystal'],
      });
    }
  });

  // --- Lumen wisps (floating lights) ----------------------------------------
  const wisps: Array<{ name: string; color: ColorHex; light: boolean }> = [
    { name: 'Lumen Wisp of Dawn', color: '#5fe6ff', light: true },
    { name: 'Lumen Wisp of Dusk', color: '#b07bff', light: true },
    { name: 'Lumen Wisp of Tides', color: '#4ff0d0', light: true },
    { name: 'Lumen Wisp of Embers', color: '#ff9ad5', light: false },
    { name: 'Lumen Wisp of Stars', color: '#9fb4ff', light: false },
  ];
  wisps.forEach((w, i) => {
    const angle = (i / wisps.length) * Math.PI * 2 + 0.4;
    const radius = rng.range(13, 20);
    add({
      id: id(w.name),
      name: w.name,
      kind: 'light',
      archetype: 'lightOrb',
      position: [round(Math.cos(angle) * radius), round(rng.range(6, 15)), round(Math.sin(angle) * radius)],
      scale: [0.9, 0.9, 0.9],
      color: w.color,
      emissive: w.color,
      emissiveIntensity: 4,
      tags: ['light', 'wisp'],
      ...(w.light ? { light: { color: w.color, intensity: 90, range: 28 } } : {}),
    });
  });

  // --- Obsidian obelisks guarding the outer sky ------------------------------
  for (let i = 0; i < 3; i++) {
    const angle = 1.2 + i * 2.1 + rng.range(-0.2, 0.2);
    add({
      id: id(`obsidian-obelisk-${i + 1}`),
      name: `Obsidian Obelisk ${ROMAN[i] ?? String(i + 1)}`,
      kind: 'structure',
      archetype: 'obelisk',
      position: [round(Math.cos(angle) * 46), round(rng.range(-6, -2)), round(Math.sin(angle) * 46)],
      rotation: [0, round(rng.range(0, Math.PI)), round(rng.range(-0.1, 0.1))],
      scale: [1, round(rng.range(0.9, 1.3)), 1],
      color: '#141226',
      emissive: '#40e0ff',
      emissiveIntensity: 1.2,
      tags: ['monument'],
    });
  }

  return drafts.map((entity) => ({ type: 'entity/added', entity, source: 'system' }) as const);
}

export function buildCrystalKingdom(seed: number = CRYSTAL_KINGDOM_SEED): World {
  let world = createEmptyWorld({
    id: `crystal-kingdom-${seed}`,
    name: 'Crystal Kingdom at Dusk',
    biome: 'floating crystal isles',
    seed,
  });
  for (const event of crystalKingdomEvents(seed)) {
    const result = applyEvent(world, event);
    if (!result.ok) throw new Error(`Crystal Kingdom genesis failed: ${result.reason}`);
    world = result.world;
  }
  return world;
}
