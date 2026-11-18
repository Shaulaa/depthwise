import * as THREE from 'three';
import gsap from 'gsap';
import { TAU, clamp, damp } from '../core/math';
import { Scheduler, type GameContext, type MiniGame } from './types';

const RING_COUNT = 12;
const NEEDED = 9;
const RING_RADIUS = 3.1;
const REACH_X = 6.5;
const REACH_Y = 4.4;
const BASE_SPEED = 13.5;
const RACE_FOV = 56;
const CAMERA_BACK = 21;
const CAMERA_UP = 7.2;
const LOOK_AHEAD = 14;

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const GOLD = new THREE.Color('#ffd46b');
const MISSED = new THREE.Color('#ff5a4a');

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Distance along the course at which the ship crosses this ring. */
  at: number;
  x: number;
  y: number;
  state: 'ahead' | 'hit' | 'missed';
}

/** On-rails lap around the island: the ship flies itself, the player steers it through rings. */
export class RingRace implements MiniGame {
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly length: number;
  private readonly rings: Ring[] = [];
  private readonly scheduler = new Scheduler();
  private readonly geometry = new THREE.TorusGeometry(RING_RADIUS, 0.2, 8, 40);
  private readonly offset = new THREE.Vector2();
  private readonly aim = new THREE.Vector2();
  private readonly lookAt = new THREE.Vector3();
  private readonly baseFov: number;
  private phase: 'intro' | 'racing' | 'done' = 'intro';
  private distance = 0;
  private speed = 0;
  private hits = 0;
  private passed = 0;
  private streak = 0;

  // Scratch vectors for the moving frame along the course.
  private readonly point = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lift = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly ctx: GameContext) {
    const { island, group, dock } = ctx.built;
    const center = group.position;
    const startAngle = Math.atan2(dock.outward.z, dock.outward.x);
    const points: THREE.Vector3[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = startAngle + (i / count) * TAU;
      // The lap starts just off the dock, then swings wide and weaves up and down.
      const radius = island.rimRadius(angle) + (i === 0 ? 15 : 24 + Math.sin(i * 1.7) * 11);
      const height = i === 0 ? dock.position.y - center.y + 1 : 9 + Math.sin(i * 2.3 + 1) * 6.5;
      points.push(new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y + height, center.z + Math.sin(angle) * radius));
    }
    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    this.length = this.curve.getLength();
    this.baseFov = ctx.camera.fov;
  }

  start(): void {
    const { ctx } = this;

    for (let i = 0; i < RING_COUNT; i++) {
      const u = 0.07 + (i / RING_COUNT) * 0.88;
      const x = Math.sin(i * 2.1 + 0.5) * 4.3;
      const y = Math.cos(i * 1.3) * 2.7;
      this.frame(u);
      const material = new THREE.MeshBasicMaterial({ color: GOLD.clone(), transparent: true, fog: false });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.copy(this.point).addScaledVector(this.right, x).addScaledVector(this.lift, y);
      mesh.quaternion.setFromRotationMatrix(this.matrix.lookAt(this.tangent, ORIGIN, UP));
      mesh.scale.setScalar(0.001);
      gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.5, delay: 0.3 + i * 0.06, ease: 'back.out(2)' });
      ctx.world.scene.add(mesh);
      this.rings.push({ mesh, material, at: u * this.length, x, y, state: 'ahead' });
    }

    // Take the camera from the orbit rig and line the ship up on the start.
    ctx.rig.active = false;
    ctx.rig.enabled = false;
    this.lookAt.copy(ctx.rig.target);
    this.frame(0);
    ctx.world.ship.glideTo(this.point, 0, 2.6);
    ctx.world.ship.face(this.tangent);
    gsap.to(ctx.camera, { fov: RACE_FOV, duration: 1.6, ease: 'power2.inOut', onUpdate: () => ctx.camera.updateProjectionMatrix() });

    ctx.hud.setHint('Arahkan kapal pakai mouse, sentuhan, atau WASD / panah. Lewati tengah cincinnya.');
    ctx.hud.setActions([]);
    this.refresh();

    ['3', '2', '1'].forEach((digit, i) => {
      this.scheduler.after(1.0 + i * 0.8, () => {
        ctx.hud.setBanner(digit);
        ctx.audio.tick();
      });
    });
    this.scheduler.after(3.4, () => {
      ctx.hud.setBanner('Terbang!');
      ctx.audio.tick(true);
      ctx.audio.whoosh(1.4);
      ctx.world.ship.release();
      ctx.input.pointerMoved = false;
      this.phase = 'racing';
    });
    this.scheduler.after(4.3, () => ctx.hud.setBanner(null));
  }

  update(dt: number): void {
    this.scheduler.update(dt);
    const { ctx } = this;
    const ship = ctx.world.ship;

    if (this.phase === 'intro') {
      // Settle in behind the ship while it lines up.
      this.frame(0);
      this.desired.copy(ship.root.position).addScaledVector(this.tangent, -CAMERA_BACK).addScaledVector(this.lift, CAMERA_UP);
      this.chase(dt, 2.6, this.point.copy(ship.root.position).addScaledVector(this.tangent, LOOK_AHEAD));
      this.pulse();
      return;
    }

    if (this.phase === 'racing') this.steer(dt);
    else this.aim.set(0, 0);

    const prevX = this.offset.x;
    this.offset.x = damp(this.offset.x, this.aim.x, 7, dt);
    this.offset.y = damp(this.offset.y, this.aim.y, 7, dt);
    ship.bank = clamp(((this.offset.x - prevX) / Math.max(dt, 1e-4)) * 0.04, -0.3, 0.3);

    const cruise = this.phase === 'racing' ? BASE_SPEED + Math.min(this.streak, 6) * 0.7 : 6;
    this.speed = damp(this.speed, cruise, 2, dt);
    const before = this.distance;
    this.distance += this.speed * dt;

    this.frame(this.distance / this.length);
    ship.root.position.copy(this.point).addScaledVector(this.right, this.offset.x).addScaledVector(this.lift, this.offset.y);
    ship.face(this.tangent);

    if (this.phase === 'racing') {
      for (const ring of this.rings) {
        if (ring.state === 'ahead' && before < ring.at && this.distance >= ring.at) this.resolve(ring);
      }
      if (this.distance >= this.length * 0.985) this.end();
    }

    // Chase camera: high enough behind the ship that the next ring shows over the envelope.
    this.frame((this.distance - CAMERA_BACK) / this.length);
    this.desired
      .copy(this.point)
      .addScaledVector(this.lift, CAMERA_UP + this.offset.y * 0.55)
      .addScaledVector(this.right, this.offset.x * 0.55);
    this.frame((this.distance + LOOK_AHEAD) / this.length);
    this.point.addScaledVector(this.right, this.offset.x * 0.8).addScaledVector(this.lift, this.offset.y * 0.8 + 1);
    this.chase(dt, 6, this.point);
    this.pulse();
  }

  dispose(): void {
    const { ctx } = this;
    this.scheduler.clear();
    ctx.hud.setBanner(null);
    for (const ring of this.rings) {
      gsap.killTweensOf([ring.mesh.scale, ring.material]);
      ctx.world.scene.remove(ring.mesh);
      ring.material.dispose();
    }
    this.geometry.dispose();

    const ship = ctx.world.ship;
    ship.bank = 0;
    ship.glideTo(ctx.built.dock.position, ctx.built.dock.yaw, 2.2);
    gsap.to(ctx.camera, { fov: this.baseFov, duration: 1.2, ease: 'power2.inOut', onUpdate: () => ctx.camera.updateProjectionMatrix() });

    // Hand the camera back exactly where it is, so the orbit rig can ease home from here.
    ctx.rig.syncFromCamera(this.lookAt);
    ctx.rig.active = true;
    ctx.rig.enabled = true;
  }

  /** Position, tangent and side/up axes of the course at a lap fraction (wraps around). */
  private frame(u: number): void {
    const wrapped = ((u % 1) + 1) % 1;
    this.curve.getPointAt(wrapped, this.point);
    this.curve.getTangentAt(wrapped, this.tangent);
    this.right.crossVectors(this.tangent, UP).normalize();
    this.lift.crossVectors(this.right, this.tangent).normalize();
  }

  private chase(dt: number, stiffness: number, target: THREE.Vector3): void {
    const { camera } = this.ctx;
    camera.position.lerp(this.desired, 1 - Math.exp(-stiffness * dt));
    this.lookAt.lerp(target, 1 - Math.exp(-(stiffness + 2) * dt));
    camera.lookAt(this.lookAt);
  }

  private steer(dt: number): void {
    const { keys } = this.ctx.input;
    const kx = Number(keys.has('d') || keys.has('ArrowRight')) - Number(keys.has('a') || keys.has('ArrowLeft'));
    const ky = Number(keys.has('w') || keys.has('ArrowUp')) - Number(keys.has('s') || keys.has('ArrowDown'));
    if (kx !== 0 || ky !== 0) {
      this.aim.x = clamp(this.aim.x + kx * 12 * dt, -REACH_X, REACH_X);
      this.aim.y = clamp(this.aim.y + ky * 10 * dt, -REACH_Y, REACH_Y);
    } else if (this.ctx.input.pointerMoved) {
      const { ndcX, ndcY } = this.ctx.input.pointer;
      this.aim.set(clamp(ndcX * REACH_X * 1.3, -REACH_X, REACH_X), clamp(ndcY * REACH_Y * 1.3, -REACH_Y, REACH_Y));
    }
    this.ctx.input.pointerMoved = false;
  }

  private resolve(ring: Ring): void {
    const { audio } = this.ctx;
    this.passed++;
    const miss = Math.hypot(this.offset.x - ring.x, this.offset.y - ring.y);
    gsap.killTweensOf(ring.mesh.scale);
    if (miss <= RING_RADIUS) {
      ring.state = 'hit';
      this.hits++;
      this.streak++;
      audio.chime(Math.min(this.streak, 8));
      ring.material.color.copy(GOLD).multiplyScalar(5);
      gsap.to(ring.mesh.scale, { x: 1.9, y: 1.9, z: 1.9, duration: 0.45, ease: 'power2.out' });
      gsap.to(ring.material, { opacity: 0, duration: 0.45 });
    } else {
      ring.state = 'missed';
      this.streak = 0;
      audio.miss();
      ring.material.color.copy(MISSED);
      gsap.to(ring.material, { opacity: 0.22, duration: 0.4 });
    }
    this.refresh();
  }

  /** Make the next ring easy to spot and keep the rest calm. */
  private pulse(): void {
    const next = this.rings.find((ring) => ring.state === 'ahead');
    const beat = Math.sin(this.ctx.world.elapsed * 6) * 0.5 + 0.5;
    for (const ring of this.rings) {
      if (ring.state !== 'ahead') continue;
      ring.material.color.copy(GOLD).multiplyScalar(ring === next ? 2.2 + beat * 1.6 : 1.1);
    }
  }

  private end(): void {
    const { ctx } = this;
    this.phase = 'done';
    const won = this.hits >= NEEDED;
    const best = ctx.store.submit('angin', { rings: this.hits });
    const record = ctx.store.records.angin;
    if (won) ctx.audio.success();
    else ctx.audio.fail();
    ctx.finish({
      won,
      headline: won ? 'Putaran selesai' : 'Cincinnya kurang',
      lines: [
        `${this.hits} dari ${RING_COUNT} cincin terlewati`,
        won ? (best ? 'Rekor baru!' : `Rekor kamu: ${record?.rings ?? this.hits} cincin`) : `Butuh minimal ${NEEDED} cincin buat dapat cap.`,
      ],
    });
  }

  private refresh(): void {
    this.ctx.hud.setStats([
      { label: 'Cincin', value: `${this.hits}/${RING_COUNT}` },
      { label: 'Sisa', value: String(RING_COUNT - this.passed) },
      { label: 'Beruntun', value: String(this.streak) },
    ]);
  }
}
