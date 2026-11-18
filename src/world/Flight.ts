import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { Airship } from './Airship';
import type { Island } from './Island';
import type { BuiltIsland, Obstacle } from './islands';

/** Player intent, each axis in -1..1. */
export interface FlightInput {
  /** Forward (+) or reverse (-). */
  throttle: number;
  /** Right (+) or left (-). */
  turn: number;
  /** Climb (+) or descend (-). */
  lift: number;
}

/** How far the ship's hull reaches from its origin, used to keep it out of the scenery. */
export const HULL = {
  /** Half the length of the envelope, rounded up. */
  side: 4.5,
  /** Ground plus trees and roofs the keel has to clear. */
  above: 11,
  /** Room the envelope needs under an island's rocky belly. */
  below: 3,
};

const MAX_SPEED = 24;
const REVERSE_SPEED = 6;
const CLIMB_SPEED = 10;
const TURN_RATE = 1.3;
/** The open sky the ship may roam: a cylinder around the archipelago. */
export const BOUNDS = { radius: 300, floor: -40, ceiling: 150 };
/** How close to an island's rim counts as "near enough to call in". */
const DOCK_RANGE = 26;

export interface Push {
  /** Displacement that moves the point back into free air. */
  x: number;
  y: number;
  z: number;
}

/**
 * The smallest move that takes a point out of an island's solid volume, or null if it is already clear.
 * The island is treated as a band between its rocky underside and its ground plus `above`,
 * widened by `side` past the rim. `x/y/z` are in the island's local space.
 */
export function pushOutOfIsland(island: Island, x: number, y: number, z: number, hull = HULL): Push | null {
  const d = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const reach = island.rimRadius(theta) + hull.side;
  if (d >= reach) return null;

  // Sample the ground just inside the rim when the point hangs past it.
  const inner = island.rimRadius(theta) * 0.97;
  const k = d > inner ? inner / d : 1;
  const floor = island.heightAt(x * k, z * k) + hull.above;
  const ceiling = island.underAt(x * k, z * k) - hull.below;
  if (y >= floor || y <= ceiling) return null;

  const up = floor - y;
  const down = y - ceiling;
  const out = reach - d;
  if (out <= up && out <= down && d > 1e-6) return { x: (x / d) * out, y: 0, z: (z / d) * out };
  return up <= down ? { x: 0, y: up, z: 0 } : { x: 0, y: -down, z: 0 };
}

/** Same idea for a vertical cylinder (lighthouses, islets), in world space. */
export function pushOutOfObstacle(o: Obstacle, x: number, y: number, z: number, hull = HULL): Push | null {
  const dx = x - o.x;
  const dz = z - o.z;
  const d = Math.hypot(dx, dz);
  const reach = o.r + hull.side;
  const floor = o.top + hull.above * 0.5;
  const ceiling = o.bottom - hull.below;
  if (d >= reach || y >= floor || y <= ceiling) return null;

  const up = floor - y;
  const down = y - ceiling;
  const out = reach - d;
  if (out <= up && out <= down && d > 1e-6) return { x: (dx / d) * out, y: 0, z: (dz / d) * out };
  return up <= down ? { x: 0, y: up, z: 0 } : { x: 0, y: -down, z: 0 };
}

/** Keep a point inside the flyable sky. Returns true if it had to be moved. */
export function clampToBounds(p: THREE.Vector3): boolean {
  let moved = false;
  const d = Math.hypot(p.x, p.z);
  if (d > BOUNDS.radius) {
    p.x *= BOUNDS.radius / d;
    p.z *= BOUNDS.radius / d;
    moved = true;
  }
  if (p.y < BOUNDS.floor || p.y > BOUNDS.ceiling) {
    p.y = clamp(p.y, BOUNDS.floor, BOUNDS.ceiling);
    moved = true;
  }
  return moved;
}

/**
 * Move a point out of every island and obstacle. A couple of passes settle corners where two
 * volumes meet. Returns the total displacement applied (zero when nothing was hit).
 */
export function resolveCollisions(
  p: THREE.Vector3,
  islands: Iterable<BuiltIsland>,
  hull = HULL,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.set(0, 0, 0);
  for (let pass = 0; pass < 2; pass++) {
    for (const built of islands) {
      const g = built.group.position;
      const push = pushOutOfIsland(built.island, p.x - g.x, p.y - g.y, p.z - g.z, hull);
      if (push) {
        p.x += push.x;
        p.y += push.y;
        p.z += push.z;
        out.x += push.x;
        out.y += push.y;
        out.z += push.z;
      }
      for (const obstacle of built.obstacles) {
        const hit = pushOutOfObstacle(obstacle, p.x, p.y, p.z, hull);
        if (!hit) continue;
        p.x += hit.x;
        p.y += hit.y;
        p.z += hit.z;
        out.x += hit.x;
        out.y += hit.y;
        out.z += hit.z;
      }
    }
  }
  return out;
}

const forward = new THREE.Vector3();
const push = new THREE.Vector3();

/** Free flight: turns player input into airship motion, with inertia and solid scenery. */
export class Flight {
  /** Heading in radians; 0 points the bow along +Z. */
  yaw = 0;
  /** Signed speed along the bow, world units per second. */
  speed = 0;
  private climb = 0;
  private turnRate = 0;

  constructor(
    private readonly ship: Airship,
    private readonly islands: Map<string, BuiltIsland>,
  ) {}

  /**
   * Take over from wherever the ship currently is, at rest.
   * @param liftOff Start with an upward surge, so leaving a pier clears the treetops.
   */
  begin(liftOff = false): void {
    this.ship.release();
    forward.set(0, 0, 1).applyQuaternion(this.ship.root.quaternion);
    this.yaw = Math.atan2(forward.x, forward.z);
    this.speed = 0;
    this.climb = liftOff ? 22 : 0;
    this.turnRate = 0;
  }

  /** 0 at rest, 1 at full speed. */
  get pace(): number {
    return Math.abs(this.speed) / MAX_SPEED;
  }

  update(dt: number, input: FlightInput): void {
    const throttle = clamp(input.throttle, -1, 1);
    const target = throttle >= 0 ? throttle * MAX_SPEED : throttle * REVERSE_SPEED;
    // Airships are heavy: they pick up speed slowly and coast even longer.
    this.speed = damp(this.speed, target, throttle !== 0 ? 0.9 : 0.55, dt);

    // Turning is sluggish at a standstill and sharpens once there is air over the rudder.
    const authority = 0.45 + 0.55 * Math.min(1, Math.abs(this.speed) / 8);
    this.turnRate = damp(this.turnRate, -clamp(input.turn, -1, 1) * TURN_RATE * authority, 4, dt);
    this.yaw += this.turnRate * dt;
    this.climb = damp(this.climb, clamp(input.lift, -1, 1) * CLIMB_SPEED, 2.6, dt);

    const p = this.ship.root.position;
    forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    p.addScaledVector(forward, this.speed * dt);
    p.y += this.climb * dt;

    const hit = resolveCollisions(p, this.islands.values(), HULL, push);
    if (hit.y > 0 && this.climb < 0) this.climb = 0;
    if (hit.y < 0 && this.climb > 0) this.climb = 0;
    // Scraping along a cliff bleeds off speed instead of stopping dead.
    if ((hit.x !== 0 || hit.z !== 0) && forward.dot(push.setY(0)) * this.speed < 0) {
      this.speed *= Math.exp(-5 * dt);
    }
    if (clampToBounds(p)) this.speed *= Math.exp(-3 * dt);

    this.ship.turnTo(this.yaw);
    this.ship.bank = clamp(this.turnRate * 0.12, -0.15, 0.15);
  }

  /** The island the ship is close enough to call at, if any. */
  nearby(): BuiltIsland | null {
    const p = this.ship.root.position;
    let best: BuiltIsland | null = null;
    let bestGap = Infinity;
    for (const built of this.islands.values()) {
      const g = built.group.position;
      const dy = p.y - g.y;
      if (dy < -40 || dy > 50) continue;
      const theta = Math.atan2(p.z - g.z, p.x - g.x);
      const gap = Math.hypot(p.x - g.x, p.z - g.z) - built.island.rimRadius(theta);
      if (gap < DOCK_RANGE && gap < bestGap) {
        best = built;
        bestGap = gap;
      }
    }
    return best;
  }

  /** The island closest to the ship, however far. */
  closest(): BuiltIsland {
    const p = this.ship.root.position;
    let best: BuiltIsland | null = null;
    let bestDistance = Infinity;
    for (const built of this.islands.values()) {
      const distance = built.group.position.distanceToSquared(p);
      if (distance < bestDistance) {
        best = built;
        bestDistance = distance;
      }
    }
    if (!best) throw new Error('The archipelago is empty.');
    return best;
  }
}
