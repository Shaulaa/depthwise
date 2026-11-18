import * as THREE from 'three';
import { damp, lerp } from '../core/math';
import type { PointerInfo } from '../core/Input';
import type { GameLantern } from '../world/islands';
import { Scheduler, type GameContext, type MiniGame } from './types';

const ROUNDS = 5;
const START_LENGTH = 3;
const LIVES = 3;
const HIT_RADIUS = 1.05;

/** Memory game: the lanterns light up in a growing sequence that has to be repeated. */
export class LanternMemory implements MiniGame {
  private readonly scheduler = new Scheduler();
  private readonly lanterns: GameLantern[];
  private readonly glow: number[];
  private readonly hold: number[];
  private readonly sequence: number[] = [];
  private readonly pointer = new THREE.Vector2();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), HIT_RADIUS);
  private readonly hitPoint = new THREE.Vector3();
  private phase: 'watch' | 'play' | 'pause' | 'done' = 'pause';
  private round = 1;
  private lives = LIVES;
  private position = 0;

  constructor(private readonly ctx: GameContext) {
    const lanterns = ctx.built.lanterns;
    if (!lanterns?.length) throw new Error('This island has no lanterns to play on.');
    this.lanterns = lanterns;
    this.glow = lanterns.map(() => 0);
    this.hold = lanterns.map(() => 0);
  }

  start(): void {
    const { ctx } = this;
    const court = ctx.built.court ?? ctx.built.focus;
    ctx.built.gameActive = true;

    // Lanterns read best in low light, so bring dusk forward if it is still bright.
    if (ctx.world.day.night < 0.55) ctx.world.day.goTo(0.775, 2.8);

    void ctx.rig.flyTo(
      { target: court.clone().setY(court.y + 1.9), theta: 0, phi: 1.2, radius: 16.5 },
      1.6,
      { minPhi: 0.55, maxPhi: 1.42, minRadius: 11, maxRadius: 25 },
    );

    for (let i = 0; i < START_LENGTH; i++) this.sequence.push(this.nextLantern());
    ctx.hud.setActions([]);
    ctx.hud.setHint('Lenteranya bakal menyala berurutan. Hafalin, ya.');
    this.refresh();
    this.scheduler.after(2.0, () => this.demonstrate());
  }

  update(dt: number): void {
    this.scheduler.update(dt);
    this.lanterns.forEach((lantern, i) => {
      if ((this.hold[i] as number) > 0) this.hold[i] = (this.hold[i] as number) - dt;
      else this.glow[i] = damp(this.glow[i] as number, 0, 9, dt);
      const glow = this.glow[i] as number;
      lantern.material.color.copy(lantern.color).multiplyScalar(lerp(0.3, 4.4, glow));
      lantern.mesh.scale.setScalar(1 + glow * 0.14);
    });
  }

  tap(pointer: PointerInfo): void {
    if (this.phase !== 'play') return;
    const { raycaster, camera } = this.ctx;
    this.pointer.set(pointer.ndcX, pointer.ndcY);
    raycaster.setFromCamera(this.pointer, camera);

    let best = -1;
    let bestDistance = Infinity;
    this.lanterns.forEach((lantern, i) => {
      lantern.mesh.getWorldPosition(this.sphere.center);
      if (!raycaster.ray.intersectSphere(this.sphere, this.hitPoint)) return;
      const distance = this.hitPoint.distanceTo(raycaster.ray.origin);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best >= 0) this.press(best);
  }

  key(key: string): void {
    const index = Number(key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < this.lanterns.length) this.press(index);
  }

  dispose(): void {
    this.scheduler.clear();
    for (const lantern of this.lanterns) lantern.mesh.scale.setScalar(1);
    this.ctx.built.gameActive = false;
  }

  /** Random lantern that differs from the previous one, so sequences never stutter. */
  private nextLantern(): number {
    const last = this.sequence[this.sequence.length - 1];
    let pick = Math.floor(Math.random() * this.lanterns.length);
    if (pick === last) pick = (pick + 1 + Math.floor(Math.random() * (this.lanterns.length - 1))) % this.lanterns.length;
    return pick;
  }

  private flash(index: number, duration: number): void {
    this.glow[index] = 1;
    this.hold[index] = duration;
    this.ctx.audio.note(index);
  }

  private demonstrate(): void {
    const { hud } = this.ctx;
    this.phase = 'watch';
    this.position = 0;
    hud.setHint('Perhatikan urutan nyalanya…');
    // Later rounds play back a little faster.
    const step = Math.max(0.42, 0.68 - this.round * 0.045);
    this.sequence.forEach((index, i) => {
      this.scheduler.after(0.5 + i * step, () => this.flash(index, step * 0.55));
    });
    this.scheduler.after(0.5 + this.sequence.length * step + 0.1, () => {
      this.phase = 'play';
      hud.setHint('Giliranmu. Klik lentera sesuai urutannya, atau tekan 1–5.');
    });
  }

  private press(index: number): void {
    if (this.phase !== 'play') return;
    this.flash(index, 0.2);
    if (index !== this.sequence[this.position]) {
      this.wrong();
      return;
    }
    this.position++;
    if (this.position < this.sequence.length) return;

    this.phase = 'pause';
    if (this.round === ROUNDS) {
      this.win();
      return;
    }
    this.round++;
    this.sequence.push(this.nextLantern());
    this.refresh();
    this.ctx.hud.setHint('Pas. Babak berikutnya lebih panjang…');
    this.scheduler.after(1.2, () => this.demonstrate());
  }

  private wrong(): void {
    const { ctx } = this;
    this.phase = 'pause';
    this.lives--;
    ctx.audio.fail();
    this.refresh();
    if (this.lives > 0) {
      ctx.hud.setHint('Urutannya meleset. Perhatikan sekali lagi.');
      this.scheduler.after(1.4, () => this.demonstrate());
      return;
    }
    this.phase = 'done';
    this.scheduler.after(0.8, () =>
      ctx.finish({
        won: false,
        headline: 'Nadanya meleset',
        lines: [`Kamu sampai babak ${this.round} dari ${ROUNDS}.`, 'Coba lagi, urutannya bakal baru.'],
      }),
    );
  }

  private win(): void {
    const { ctx } = this;
    this.phase = 'done';
    ctx.audio.success();
    // Two sweeps of light across the arc.
    for (let sweep = 0; sweep < 2; sweep++) {
      this.lanterns.forEach((_, i) => {
        this.scheduler.after(0.25 + sweep * 0.7 + i * 0.1, () => {
          this.glow[i] = 1;
          this.hold[i] = 0.25;
        });
      });
    }
    const court = ctx.built.court ?? ctx.built.focus;
    ['#ffc857', '#ff7a5c', '#c79bff'].forEach((color, i) => {
      this.scheduler.after(0.4 + i * 0.35, () =>
        ctx.world.fireworks.burst(new THREE.Vector3(court.x + (i - 1) * 7, court.y + 13 + i * 2, court.z - 4), color, 12),
      );
    });

    const best = ctx.store.submit('lentera', { lives: this.lives });
    const record = ctx.store.records.lentera;
    this.scheduler.after(1.9, () =>
      ctx.finish({
        won: true,
        headline: 'Nyanyiannya lengkap',
        lines: [
          `Selesai dengan sisa ${this.lives} dari ${LIVES} nyawa`,
          best ? 'Rekor baru!' : `Rekor kamu: sisa ${record?.lives ?? this.lives} nyawa`,
        ],
      }),
    );
  }

  private refresh(): void {
    this.ctx.hud.setStats([
      { label: 'Babak', value: `${this.round}/${ROUNDS}` },
      { label: 'Nyawa', value: '♥'.repeat(this.lives) + '♡'.repeat(LIVES - this.lives) },
    ]);
  }
}
