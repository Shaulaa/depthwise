import * as THREE from 'three';
import { clamp, damp, shortestAngle } from '../core/math';

/** Something solid standing on an island, as a circle in island space. */
export interface Blocker {
  x: number;
  z: number;
  r: number;
}

/** A raised walkable rectangle (pier deck, stone slab), in island space, rotated `ry` about Y. */
export interface Platform {
  x: number;
  z: number;
  ry: number;
  /** Half extents along the platform's own x and z. */
  hx: number;
  hz: number;
  /** Height of the walking surface. */
  y: number;
}

/**
 * A straight flight of steps in island space, matching props.stairs(): `steps` equal treads
 * between two points, the top of tread i at the height (i + 1) / steps of the way up.
 */
export interface Stair {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  /** Half the width of the treads. */
  halfWidth: number;
  steps: number;
}

/** The parts of an island the walker needs to know about. */
export interface Ground {
  heightAt(x: number, z: number): number;
  rimRadius(theta: number): number;
}

export interface WalkArea {
  ground: Ground;
  blockers: Blocker[];
  platforms: Platform[];
  stairs?: Stair[];
}

/** Height of the tread under a point, or null if the point is not over the stairs. */
export function stairHeight(s: Stair, x: number, z: number): number | null {
  const ax = s.to.x - s.from.x;
  const az = s.to.z - s.from.z;
  const lengthSq = ax * ax + az * az;
  if (lengthSq < 1e-9) return null;
  const t = ((x - s.from.x) * ax + (z - s.from.z) * az) / lengthSq;
  if (t < 0 || t > 1) return null;
  // Distance across the flight, from its centre line.
  const across = Math.abs((x - s.from.x) * az - (z - s.from.z) * ax) / Math.sqrt(lengthSq);
  if (across > s.halfWidth) return null;
  const tread = Math.max(1, Math.ceil(t * s.steps - 1e-9));
  return s.from.y + ((s.to.y - s.from.y) * tread) / s.steps;
}

/** Radius of the character's footprint. */
export const BODY_RADIUS = 0.38;
/** Feet stay this far inside the rim, so nobody walks off the edge of the world. */
export const EDGE = 1.1;
/** Tallest ledge the character steps up without jumping. */
export const STEP = 0.7;

const WALK_SPEED = 4.6;
const RUN_SPEED = 8.2;
const JUMP_SPEED = 7.4;
const GRAVITY = 22;

/** Is a point (island space) on top of a platform's footprint? */
export function onPlatform(p: Platform, x: number, z: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  const cos = Math.cos(p.ry);
  const sin = Math.sin(p.ry);
  // Inverse of the prop transform: x' = x cos + z sin, z' = -x sin + z cos.
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz;
}

/** Height of whatever the character would stand on at a point, or null past the edge. */
export function groundAt(area: WalkArea, x: number, z: number): number | null {
  let height = -Infinity;
  const reach = area.ground.rimRadius(Math.atan2(z, x)) - EDGE;
  if (Math.hypot(x, z) < reach) height = area.ground.heightAt(x, z);
  for (const platform of area.platforms) {
    if (onPlatform(platform, x, z)) height = Math.max(height, platform.y);
  }
  for (const stair of area.stairs ?? []) {
    const tread = stairHeight(stair, x, z);
    if (tread !== null) height = Math.max(height, tread);
  }
  return height === -Infinity ? null : height;
}

/** Shove a point out of every blocker it overlaps. Returns true if it moved. */
export function pushOutOfBlockers(area: WalkArea, p: { x: number; z: number }, radius = BODY_RADIUS): boolean {
  let moved = false;
  for (const b of area.blockers) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const reach = b.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2);
    // Dead centre: pick any direction rather than dividing by zero.
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    p.x = b.x + nx * reach;
    p.z = b.z + nz * reach;
    moved = true;
  }
  return moved;
}

/**
 * Where a character at `from` ends up after trying to move by (dx, dz).
 * Blockers push it aside; edges and tall ledges stop it, sliding along them where possible.
 * `feet` is the current height of the feet, which decides what counts as too tall to step onto.
 */
export function slide(area: WalkArea, from: { x: number; z: number }, dx: number, dz: number, feet: number): { x: number; z: number } {
  const attempts: [number, number][] = [
    [dx, dz],
    [dx, 0],
    [0, dz],
  ];
  for (const [mx, mz] of attempts) {
    if (mx === 0 && mz === 0) continue;
    const p = { x: from.x + mx, z: from.z + mz };
    pushOutOfBlockers(area, p);
    const ground = groundAt(area, p.x, p.z);
    if (ground !== null && ground <= feet + STEP) return p;
  }
  return { x: from.x, z: from.z };
}

export interface WalkInput {
  /** Desired direction in world space, length 0..1. */
  x: number;
  z: number;
  run: boolean;
}

/** A character on foot: position, velocity, jumping and falling over an island's surface. */
export class Walker {
  /** Feet position in world space. */
  readonly position = new THREE.Vector3();
  /** Heading in radians; 0 faces +Z. */
  yaw = 0;
  /** Horizontal speed, world units per second. */
  speed = 0;
  grounded = true;
  /** Vertical velocity, positive going up. */
  climb = 0;

  private readonly velocity = new THREE.Vector2();
  private area: WalkArea | null = null;
  private readonly origin = new THREE.Vector3();
  private jumpQueued = false;

  /** Put the walker on an island. `origin` is the island's world position. */
  enter(area: WalkArea, origin: THREE.Vector3, at: THREE.Vector3, yaw: number): void {
    this.area = area;
    this.origin.copy(origin);
    this.position.copy(at);
    this.yaw = yaw;
    this.speed = 0;
    this.climb = 0;
    this.velocity.set(0, 0);
    this.grounded = true;
    this.jumpQueued = false;
    const ground = groundAt(area, at.x - origin.x, at.z - origin.z);
    if (ground !== null) this.position.y = origin.y + ground;
  }

  /** Ask for a jump; it happens on the next update if the feet are on the ground. */
  jump(): void {
    this.jumpQueued = true;
  }

  /** Returns true on the frame the walker leaves the ground by jumping. */
  update(dt: number, input: WalkInput): { jumped: boolean; landed: boolean } {
    const area = this.area;
    if (!area) return { jumped: false, landed: false };

    const length = Math.min(1, Math.hypot(input.x, input.z));
    const top = input.run ? RUN_SPEED : WALK_SPEED;
    const dirX = length > 1e-3 ? input.x / Math.hypot(input.x, input.z) : 0;
    const dirZ = length > 1e-3 ? input.z / Math.hypot(input.x, input.z) : 0;
    // Quick to start and stop, a little floatier in the air.
    const grip = this.grounded ? 12 : 3;
    this.velocity.x = damp(this.velocity.x, dirX * length * top, grip, dt);
    this.velocity.y = damp(this.velocity.y, dirZ * length * top, grip, dt);
    if (length > 1e-3) {
      const want = Math.atan2(dirX, dirZ);
      this.yaw += shortestAngle(this.yaw, want) * (1 - Math.exp(-14 * dt));
    }

    const local = { x: this.position.x - this.origin.x, z: this.position.z - this.origin.z };
    const feet = this.position.y - this.origin.y;
    const next = slide(area, local, this.velocity.x * dt, this.velocity.y * dt, feet);
    const moved = Math.hypot(next.x - local.x, next.z - local.z);
    this.speed = moved / Math.max(dt, 1e-4);
    // Walking into a wall should not keep building speed against it.
    if (moved < Math.hypot(this.velocity.x, this.velocity.y) * dt * 0.5) this.velocity.multiplyScalar(Math.exp(-10 * dt));

    let jumped = false;
    if (this.jumpQueued && this.grounded) {
      this.climb = JUMP_SPEED;
      this.grounded = false;
      jumped = true;
    }
    this.jumpQueued = false;

    const ground = groundAt(area, next.x, next.z) ?? feet;
    let y = feet;
    let landed = false;
    if (this.grounded && feet - ground < 0.45) {
      // Hug the slope on the way down instead of hopping off every bump.
      y = ground;
    } else {
      this.climb -= GRAVITY * dt;
      y = feet + this.climb * dt;
      if (y <= ground) {
        y = ground;
        landed = !this.grounded;
        this.climb = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    }
    if (y < ground) y = ground;

    this.position.set(next.x + this.origin.x, clamp(y, ground, ground + 40) + this.origin.y, next.z + this.origin.z);
    return { jumped, landed };
  }

  /** Horizontal distance from the feet to a world point. */
  distanceTo(point: THREE.Vector3): number {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z);
  }
}
