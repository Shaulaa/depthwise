import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Island } from '../src/world/Island';
import {
  BODY_RADIUS,
  EDGE,
  STEP,
  Walker,
  groundAt,
  onPlatform,
  pushOutOfBlockers,
  slide,
  stairHeight,
  type WalkArea,
} from '../src/world/Walk';

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

const pier = { x: island.rimRadius(0) + 2, z: 0, ry: 0, hx: 4, hz: 1, y: 0.6 };
const area: WalkArea = {
  ground: island,
  blockers: [{ x: 5, z: 0, r: 1 }],
  platforms: [pier, { x: -6, z: 0, ry: 0, hx: 1, hz: 1, y: island.heightAt(-6, 0) + STEP + 1 }],
};

describe('groundAt', () => {
  it('follows the island surface inside the rim', () => {
    expect(groundAt(area, 0, 3)).toBeCloseTo(island.heightAt(0, 3));
  });

  it('has no ground past the edge, except on a platform', () => {
    const rim = island.rimRadius(Math.PI / 2);
    expect(groundAt(area, 0, rim - EDGE + 0.2)).toBeNull();
    expect(groundAt(area, pier.x + 3, 0)).toBeCloseTo(pier.y);
  });
});

describe('onPlatform', () => {
  it('respects the platform rotation', () => {
    const turned = { x: 0, z: 0, ry: Math.PI / 2, hx: 3, hz: 0.5, y: 0 };
    // Rotated a quarter turn, the long side runs along z instead of x.
    expect(onPlatform(turned, 0, 2.5)).toBe(true);
    expect(onPlatform(turned, 2.5, 0)).toBe(false);
  });
});

describe('stairHeight', () => {
  const flight = { from: { x: 0, y: 1, z: 10 }, to: { x: 0, y: 3, z: 6 }, halfWidth: 1.5, steps: 4 };

  it('stands on the tread under the feet, matching the stair geometry', () => {
    // Four treads of 0.5 each; the first tread's top is one riser above the foot.
    expect(stairHeight(flight, 0, 9.9)).toBeCloseTo(1.5);
    expect(stairHeight(flight, 0, 8.6)).toBeCloseTo(2);
    expect(stairHeight(flight, 0.4, 7.4)).toBeCloseTo(2.5);
    expect(stairHeight(flight, 0, 6.1)).toBeCloseTo(3);
  });

  it('ignores points beside or beyond the flight', () => {
    expect(stairHeight(flight, 2, 8)).toBeNull();
    expect(stairHeight(flight, 0, 11)).toBeNull();
    expect(stairHeight(flight, 0, 5)).toBeNull();
  });

  it('lifts the ground above a hillside that sits below the treads', () => {
    const stepped: WalkArea = { ...area, stairs: [{ ...flight, from: { x: 0, y: 30, z: 4 }, to: { x: 0, y: 32, z: 0 } }] };
    expect(groundAt(stepped, 0, 2.5)).toBeCloseTo(31);
  });
});

describe('pushOutOfBlockers', () => {
  it('moves a point to the edge of the blocker it overlaps', () => {
    const p = { x: 5.5, z: 0 };
    expect(pushOutOfBlockers(area, p)).toBe(true);
    expect(p.x).toBeCloseTo(5 + 1 + BODY_RADIUS);
    expect(p.z).toBeCloseTo(0);
  });

  it('leaves clear points alone', () => {
    const p = { x: 0, z: 0 };
    expect(pushOutOfBlockers(area, p)).toBe(false);
    expect(p).toEqual({ x: 0, z: 0 });
  });
});

describe('slide', () => {
  it('refuses to step off the edge but slides along it', () => {
    const rim = island.rimRadius(Math.PI / 2);
    // Far enough in that the sideways step stays on the island wherever the wobbly rim runs.
    const from = { x: 0, z: rim - EDGE - 0.6 };
    const feet = island.heightAt(from.x, from.z);
    const to = slide(area, from, 0.3, 2, feet);
    expect(to.z).toBeCloseTo(from.z); // the step outwards was dropped
    expect(to.x).toBeCloseTo(0.3); // the sideways part survived
  });

  it('stops at a ledge taller than a step', () => {
    const feet = island.heightAt(-8.2, 0);
    const to = slide(area, { x: -8.2, z: 0 }, 1.4, 0, feet);
    expect(to.x).toBeCloseTo(-8.2);
  });
});

describe('Walker', () => {
  it('walks, jumps and lands back on the ground', () => {
    const walker = new Walker();
    const origin = new THREE.Vector3(10, 20, -5);
    walker.enter(area, origin, new THREE.Vector3(origin.x, 0, origin.z - 4), 0);
    expect(walker.position.y).toBeCloseTo(origin.y + island.heightAt(0, -4));

    for (let i = 0; i < 30; i++) walker.update(1 / 60, { x: 0, z: 1, run: false });
    expect(walker.position.z).toBeGreaterThan(origin.z - 4 + 1);
    expect(walker.yaw).toBeCloseTo(0, 1);

    walker.jump();
    const { jumped } = walker.update(1 / 60, { x: 0, z: 0, run: false });
    expect(jumped).toBe(true);
    let peak = walker.position.y;
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      landed = walker.update(1 / 60, { x: 0, z: 0, run: false }).landed;
      peak = Math.max(peak, walker.position.y);
    }
    expect(landed).toBe(true);
    expect(peak - origin.y - island.heightAt(walker.position.x - origin.x, walker.position.z - origin.z)).toBeGreaterThan(1);
    expect(walker.grounded).toBe(true);
  });
});
