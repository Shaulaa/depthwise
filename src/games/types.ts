import type * as THREE from 'three';
import type { AudioEngine } from '../core/AudioEngine';
import type { CameraRig } from '../core/CameraRig';
import type { Input, PointerInfo } from '../core/Input';
import type { Store } from '../core/Store';
import type { BuiltIsland } from '../world/islands';
import type { World } from '../world/World';

export interface Stat {
  label: string;
  value: string;
}

export interface GameAction {
  label: string;
  onClick: () => void;
}

/** The slice of the UI a mini game is allowed to drive. */
export interface GameHud {
  setStats(stats: readonly Stat[]): void;
  setHint(text: string): void;
  setActions(actions: readonly GameAction[]): void;
  /** Reference image shown in the corner, or null to hide it. */
  setPreview(src: string | null): void;
  /** Large centred text, such as a countdown. Null clears it. */
  setBanner(text: string | null): void;
}

export interface GameOutcome {
  won: boolean;
  headline: string;
  lines: string[];
}

export interface GameContext {
  world: World;
  built: BuiltIsland;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  input: Input;
  raycaster: THREE.Raycaster;
  audio: AudioEngine;
  store: Store;
  hud: GameHud;
  /** Report the end of a round. The game stays alive until it is disposed. */
  finish(outcome: GameOutcome): void;
}

export interface MiniGame {
  start(): void;
  update(dt: number): void;
  tap?(pointer: PointerInfo): void;
  key?(key: string): void;
  /** Remove everything the game added and hand the scene back as it was found. */
  dispose(): void;
}

/** Delayed callbacks that die with the game, unlike setTimeout. */
export class Scheduler {
  private clock = 0;
  private queue: { at: number; run: () => void }[] = [];

  after(delay: number, run: () => void): void {
    this.queue.push({ at: this.clock + delay, run });
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.queue.length === 0) return;
    const due = this.queue.filter((item) => item.at <= this.clock);
    if (due.length === 0) return;
    this.queue = this.queue.filter((item) => item.at > this.clock);
    due.sort((a, b) => a.at - b.at).forEach((item) => item.run());
  }

  clear(): void {
    this.queue = [];
  }
}
