import * as THREE from 'three';
import gsap from 'gsap';
import { formatTime } from '../core/math';
import type { PointerInfo } from '../core/Input';
import { Scheduler, type GameContext, type MiniGame } from './types';

const HIT_RADIUS = 1.5;
const HINT_COOLDOWN = 10;
const GLOW = new THREE.Color('#8ff3dc');

interface Crystal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  home: THREE.Vector3;
  found: boolean;
}

/** Hidden-object hunt: orbit the island and click the six glowing crystals. */
export class HiddenCrystals implements MiniGame {
  private readonly crystals: Crystal[] = [];
  private readonly scheduler = new Scheduler();
  private readonly geometry = new THREE.OctahedronGeometry(0.5);
  private readonly ring: THREE.Mesh;
  private readonly pointer = new THREE.Vector2();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), HIT_RADIUS);
  private readonly hitPoint = new THREE.Vector3();
  private time = 0;
  private found = 0;
  private playing = false;
  private hintReady = 0;
  private hinted: Crystal | null = null;

  constructor(private readonly ctx: GameContext) {
    this.geometry.scale(1, 1.55, 1);
    // A ring that draws over everything, so a hint still helps when the crystal is behind a tree.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.75, 40),
      new THREE.MeshBasicMaterial({
        color: GLOW.clone().multiplyScalar(2),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.renderOrder = 10;
    this.ring.visible = false;
  }

  start(): void {
    const { ctx } = this;
    const spots = ctx.built.crystalSpots;
    if (!spots) throw new Error('This island has no crystal hiding places.');

    for (const spot of spots) {
      const material = new THREE.MeshBasicMaterial({ color: GLOW.clone().multiplyScalar(2.4), fog: false });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.copy(spot);
      mesh.scale.setScalar(0.001);
      gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.5 + this.crystals.length * 0.08, ease: 'back.out(2)' });
      ctx.world.scene.add(mesh);
      this.crystals.push({ mesh, material, home: spot.clone(), found: false });
    }
    ctx.world.scene.add(this.ring);

    ctx.hud.setHint('Putar dan perbesar kamera, lalu klik kristal yang berpendar. Ada yang ngumpet di bawah pulau.');
    ctx.hud.setActions([{ label: 'Petunjuk', onClick: () => this.hint() }]);
    this.refresh();

    void ctx.rig.flyTo({ target: ctx.built.focus, ...ctx.built.view }, 1.4, {
      minPhi: 0.2,
      maxPhi: 2.2, // well past the horizon, so the underside can be searched too
      minRadius: 14,
      maxRadius: 84,
    });
    this.scheduler.after(1.1, () => {
      this.playing = true;
    });
  }

  update(dt: number): void {
    this.scheduler.update(dt);
    const t = this.ctx.world.elapsed;
    this.crystals.forEach((crystal, i) => {
      if (crystal.found) return;
      crystal.mesh.rotation.y += dt * 1.2;
      crystal.mesh.position.y = crystal.home.y + Math.sin(t * 1.6 + i * 1.1) * 0.14;
      crystal.material.color.copy(GLOW).multiplyScalar(2.1 + Math.sin(t * 3 + i * 2) * 0.5);
    });

    if (this.ring.visible && this.hinted) {
      this.ring.position.copy(this.hinted.mesh.position);
      this.ring.quaternion.copy(this.ctx.camera.quaternion);
      this.ring.scale.setScalar(1 + (Math.sin(t * 5) * 0.5 + 0.5) * 0.5);
    }

    if (!this.playing) return;
    this.time += dt;
    this.refresh();
  }

  tap(pointer: PointerInfo): void {
    if (!this.playing) return;
    const { raycaster, camera, built } = this.ctx;
    this.pointer.set(pointer.ndcX, pointer.ndcY);
    raycaster.setFromCamera(this.pointer, camera);

    let best: Crystal | null = null;
    let bestDistance = Infinity;
    for (const crystal of this.crystals) {
      if (crystal.found) continue;
      this.sphere.center.copy(crystal.mesh.position);
      if (!raycaster.ray.intersectSphere(this.sphere, this.hitPoint)) continue;
      const distance = this.hitPoint.distanceTo(raycaster.ray.origin);
      if (distance < bestDistance) {
        best = crystal;
        bestDistance = distance;
      }
    }
    if (!best) return;

    // Solid rock blocks a click; foliage is forgiven so the hunt stays fun.
    const rock = raycaster.intersectObject(built.island.mesh, false)[0];
    if (rock && rock.distance < bestDistance - HIT_RADIUS) return;
    this.collect(best);
  }

  dispose(): void {
    this.scheduler.clear();
    const { scene } = this.ctx.world;
    for (const crystal of this.crystals) {
      gsap.killTweensOf(crystal.mesh.scale);
      scene.remove(crystal.mesh);
      crystal.material.dispose();
    }
    gsap.killTweensOf(this.ring.material);
    scene.remove(this.ring);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.geometry.dispose();
  }

  private collect(crystal: Crystal): void {
    const { ctx } = this;
    crystal.found = true;
    this.found++;
    ctx.audio.chime(this.found + 1);
    ctx.world.fireworks.burst(crystal.mesh.position, '#8ff3dc', 5);
    gsap.killTweensOf(crystal.mesh.scale);
    gsap.to(crystal.mesh.scale, { x: 2.6, y: 2.6, z: 2.6, duration: 0.22, ease: 'power2.out' });
    gsap.to(crystal.mesh.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, delay: 0.22, onComplete: () => void (crystal.mesh.visible = false) });
    if (this.hinted === crystal) this.clearHint();
    this.refresh();
    if (this.found === this.crystals.length) this.win();
  }

  private hint(): void {
    if (!this.playing || this.time < this.hintReady) return;
    const hidden = this.crystals.filter((crystal) => !crystal.found);
    const target = hidden[Math.floor(Math.random() * hidden.length)];
    if (!target) return;
    this.hinted = target;
    this.hintReady = this.time + HINT_COOLDOWN;
    this.ring.visible = true;
    const material = this.ring.material as THREE.MeshBasicMaterial;
    gsap.killTweensOf(material);
    gsap.fromTo(material, { opacity: 0 }, { opacity: 0.95, duration: 0.3 });
    gsap.to(material, { opacity: 0, duration: 0.6, delay: 3.6, onComplete: () => this.clearHint() });
    this.ctx.audio.click();
  }

  private clearHint(): void {
    this.hinted = null;
    this.ring.visible = false;
  }

  private win(): void {
    const { ctx } = this;
    this.playing = false;
    ctx.audio.success();
    const result = { time: this.time };
    const best = ctx.store.submit('rimba', result);
    const record = ctx.store.records.rimba;
    this.scheduler.after(1.2, () =>
      ctx.finish({
        won: true,
        headline: 'Semua kristal ketemu',
        lines: [
          `Selesai dalam ${formatTime(result.time)}`,
          best ? 'Rekor baru!' : `Rekor kamu: ${formatTime(record?.time ?? result.time)}`,
        ],
      }),
    );
  }

  private refresh(): void {
    const wait = Math.ceil(this.hintReady - this.time);
    this.ctx.hud.setStats([
      { label: 'Kristal', value: `${this.found}/${this.crystals.length || 6}` },
      { label: 'Waktu', value: formatTime(this.time) },
      { label: 'Petunjuk', value: wait > 0 ? `${wait} dtk` : 'siap' },
    ]);
  }
}
