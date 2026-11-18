import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOUNDS, HULL, clampToBounds, pushOutOfIsland, pushOutOfObstacle } from '../src/world/Flight';
import { Island } from '../src/world/Island';

const island = new Island({
  seed: 3,
  radius: 20,
  depth: 20,
  plateau: 2,
  hills: 0,
  palette: {
    grassA: '#7cc260',
    grassB: '#5fae58',
    sand: '#d9c58f',
    soil: '#8a6a4a',
    cliff: '#9b8f7f',
    rockA: '#8b7d74',
    rockB: '#4d4658',
  },
});

describe('pushOutOfIsland', () => {
  it('leaves points in open sky alone', () => {
    expect(pushOutOfIsland(island, 0, 40, 0)).toBeNull(); // high above
    expect(pushOutOfIsland(island, 0, -60, 0)).toBeNull(); // far below
    expect(pushOutOfIsland(island, 60, 3, 0)).toBeNull(); // well off to the side
  });

  it('lifts a ship that sinks into the middle of the island to clear the treetops', () => {
    const y = island.heightAt(0, 0) + 2;
    const push = pushOutOfIsland(island, 0, y, 0);
    expect(push).not.toBeNull();
    expect(push!.x).toBe(0);
    expect(push!.z).toBe(0);
    expect(y + push!.y).toBeCloseTo(island.heightAt(0, 0) + HULL.above);
  });

  it('drops a ship that rises into the rocky underside', () => {
    const under = island.underAt(0, 0);
    const push = pushOutOfIsland(island, 0, under + 1, 0);
    expect(push).not.toBeNull();
    expect(push!.y).toBeLessThan(0);
    expect(under + 1 + push!.y).toBeCloseTo(under - HULL.below);
  });

  it('slides a ship sideways off the rim when that is the shortest way out', () => {
    const rim = island.rimRadius(0);
    const push = pushOutOfIsland(island, rim + 1, 0, 0);
    expect(push).not.toBeNull();
    expect(push!.y).toBe(0);
    expect(push!.x).toBeGreaterThan(0);
    expect(rim + 1 + push!.x).toBeCloseTo(rim + HULL.side);
  });
});

describe('pushOutOfObstacle', () => {
  const tower = { x: 10, z: 10, r: 2, bottom: 0, top: 20 };

  it('ignores points around but not inside the cylinder', () => {
    expect(pushOutOfObstacle(tower, 30, 10, 10)).toBeNull();
    expect(pushOutOfObstacle(tower, 10, 40, 10)).toBeNull();
  });

  it('pushes out sideways from the shaft', () => {
    const push = pushOutOfObstacle(tower, 13, 10, 10);
    expect(push).not.toBeNull();
    expect(push!.x).toBeCloseTo(tower.r + HULL.side - 3);
    expect(push!.y).toBe(0);
  });
});

describe('clampToBounds', () => {
  it('keeps the ship inside the sky cylinder', () => {
    const p = new THREE.Vector3(BOUNDS.radius * 2, BOUNDS.ceiling + 50, 0);
    expect(clampToBounds(p)).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(BOUNDS.radius);
    expect(p.y).toBe(BOUNDS.ceiling);

    const inside = new THREE.Vector3(10, 10, 10);
    expect(clampToBounds(inside)).toBe(false);
    expect(inside.toArray()).toEqual([10, 10, 10]);
  });
});
