import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyEvent, createEmptyWorld } from './reducer';
import { ancestry, effectiveVisible, posesEqual, rotationFromEulerXYZ, worldPose } from './pose';
import { asEntityId, type EntityDraft, type Vec3, type World } from './types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';

function draft(id: string, parentId: string | null, position: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], visible = true): EntityDraft {
  return {
    id: asEntityId(id),
    name: id,
    kind: 'crystal',
    parentId: parentId ? asEntityId(parentId) : null,
    tags: [],
    pinned: false,
    components: {
      transform: { position, rotation, scale },
      visual: { archetype: 'crystalSpire', color: '#112233', emissive: '#445566', emissiveIntensity: 1, visible },
    },
  };
}

function build(drafts: EntityDraft[]): World {
  let w = createEmptyWorld({ id: 'p', name: 'Pose', biome: 'test', seed: 1 });
  for (const d of drafts) {
    const r = applyEvent(w, { type: 'entity/added', entity: d, source: 'system' });
    if (!r.ok) throw new Error(r.reason);
    w = r.world;
  }
  return w;
}

const chain = () =>
  build([
    draft('a', null, [3, 1, -2], [0.3, -0.7, 1.1], [2, 2, 2]),
    draft('b', 'a', [1.5, 0, 4], [-0.4, 0.2, 0.9], [0.5, 3, 1]),
    draft('c', 'b', [-2, 5, 0.25], [1.2, 0.05, -0.6], [1, 1, 4]),
  ]);

describe('rotationFromEulerXYZ', () => {
  it('matches three.js Matrix4.makeRotationFromEuler for order XYZ', () => {
    for (const e of [[0, 0, 0], [0.3, -0.7, 1.1], [Math.PI / 2, 0.1, -2.5], [-1.3, 2.9, 0.4]] as Vec3[]) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ')).elements; // column-major
      const r = rotationFromEulerXYZ(e); // row-major
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(r[i * 3 + j]).toBeCloseTo(m[j * 4 + i]!, 12);
    }
  });
});

describe('worldPose', () => {
  it('matches a three.js hierarchy where scale is applied to bodies only (renderer rule)', () => {
    const w = chain();
    // Mirror SceneRenderer: each entity is a Group (position + rotation); scale lives on a child "body".
    const groups = new Map<string, THREE.Group>();
    for (const id of w.order) {
      const t = w.entities[id]!.components.transform;
      const g = new THREE.Group();
      g.position.set(...t.position);
      g.rotation.set(...t.rotation);
      const parent = w.entities[id]!.parentId;
      (parent ? groups.get(parent)! : new THREE.Scene()).add(g);
      groups.set(id, g);
    }
    for (const id of w.order) {
      const g = groups.get(id)!;
      g.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
      const pose = worldPose(w, asEntityId(id))!;
      expect(pose.position[0]).toBeCloseTo(pos.x, 10);
      expect(pose.position[1]).toBeCloseTo(pos.y, 10);
      expect(pose.position[2]).toBeCloseTo(pos.z, 10);
      const rot = new THREE.Matrix4().extractRotation(g.matrixWorld).elements;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(pose.rotation[i * 3 + j]).toBeCloseTo(rot[j * 4 + i]!, 10);
      expect(pose.scale).toEqual(w.entities[id]!.components.transform.scale); // own scale, not inherited
    }
  });

  it('changes for a child when its parent moves, not when its parent is rescaled', () => {
    const w = chain();
    const moved = applyEvent(w, { type: 'entity/transformed', id: asEntityId('a'), transform: { position: [3, 2, -2] }, source: 'user' });
    const scaled = applyEvent(w, { type: 'entity/transformed', id: asEntityId('a'), transform: { scale: [9, 9, 9] }, source: 'user' });
    if (!moved.ok || !scaled.ok) throw new Error('setup');
    const c = asEntityId('c');
    expect(posesEqual(worldPose(w, c)!, worldPose(moved.world, c)!)).toBe(false);
    expect(posesEqual(worldPose(w, c)!, worldPose(scaled.world, c)!)).toBe(true);
  });

  it('returns null for missing entities and handles the Crystal Kingdom', () => {
    const k = buildCrystalKingdom();
    expect(worldPose(k, asEntityId('missing'))).toBeNull();
    for (const id of k.order) expect(worldPose(k, id)).not.toBeNull();
  });
});

describe('ancestry and effectiveVisible', () => {
  it('lists the chain root-first', () => {
    expect(ancestry(chain(), asEntityId('c'))).toEqual(['a', 'b', 'c']);
    expect(ancestry(chain(), asEntityId('missing'))).toEqual([]);
  });

  it('is false when the entity or any ancestor is hidden', () => {
    const w = build([draft('a', null, [0, 0, 0], [0, 0, 0], [1, 1, 1], false), draft('b', 'a', [0, 0, 0]), draft('x', null, [0, 0, 0])]);
    expect(effectiveVisible(w, asEntityId('b'))).toBe(false);
    expect(effectiveVisible(w, asEntityId('x'))).toBe(true);
    expect(effectiveVisible(w, asEntityId('missing'))).toBe(false);
  });
});
