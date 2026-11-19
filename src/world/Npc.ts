import * as THREE from 'three';
import { shortestAngle } from '../core/math';
import type { NpcInfo } from '../content';
import { Character } from './Character';
import { Walker, groundAt, type WalkArea } from './Walk';

/** Personal space: the player is kept this far from an islander's centre. */
export const NPC_RADIUS = 0.45;
/** Close enough to notice the player and turn to face them. */
const NOTICE = 4;

/** An islander: strolls around a home spot, stops to look at the player, and can be talked to. */
export class Npc {
  readonly figure: Character;
  readonly walker = new Walker();
  /** Set while a conversation is open, which keeps them still and facing the player. */
  talking = false;

  private readonly home: THREE.Vector3;
  private readonly target = new THREE.Vector3();
  private rest = 1 + Math.random() * 2;
  private strolling = false;
  private strollTime = 0;

  constructor(
    readonly info: NpcInfo,
    private readonly area: WalkArea,
    private readonly origin: THREE.Vector3,
    home: THREE.Vector3,
    yaw: number,
  ) {
    this.figure = new Character(info.look, info.outfit);
    this.home = home.clone();
    this.walker.enter(area, origin, home, yaw);
    this.figure.place(this.walker.position, yaw);
    this.figure.visible = true;
  }

  /** Feet position in world space. */
  get position(): THREE.Vector3 {
    return this.walker.position;
  }

  /**
   * @param player The player's feet, or null when they are not on this island.
   * @param active False for islands the player is nowhere near: the islander only breathes.
   */
  update(dt: number, time: number, player: THREE.Vector3 | null, active: boolean): void {
    let x = 0;
    let z = 0;
    const near = player !== null && this.walker.distanceTo(player) < NOTICE;

    if (active && !near && !this.talking) {
      if (this.strolling) {
        const dx = this.target.x - this.walker.position.x;
        const dz = this.target.z - this.walker.position.z;
        const distance = Math.hypot(dx, dz);
        this.strollTime += dt;
        // Arrived, or stuck against something: stand around for a bit.
        if (distance < 0.4 || this.strollTime > 6) {
          this.strolling = false;
          this.rest = 2 + Math.random() * 4;
        } else {
          x = (dx / distance) * 0.38;
          z = (dz / distance) * 0.38;
        }
      } else if ((this.rest -= dt) <= 0) {
        this.pickTarget();
      }
    }

    if (active) this.walker.update(dt, { x, z, run: false });
    if (near && player) {
      // Turn to look at whoever came by.
      const want = Math.atan2(player.x - this.walker.position.x, player.z - this.walker.position.z);
      this.walker.yaw += shortestAngle(this.walker.yaw, want) * (1 - Math.exp(-6 * dt));
    }
    this.figure.place(this.walker.position, this.walker.yaw);
    this.figure.update(dt, time, active ? this.walker.speed : 0, false);
  }

  private pickTarget(): void {
    const g = this.origin;
    for (let tries = 0; tries < 8; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.info.wander;
      this.target.set(this.home.x + Math.cos(angle) * r, 0, this.home.z + Math.sin(angle) * r);
      if (groundAt(this.area, this.target.x - g.x, this.target.z - g.z) !== null) break;
    }
    this.strolling = true;
    this.strollTime = 0;
  }
}
