import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, mulberry32, pick, range, smoothstep, type Rng } from '../core/math';
import { shared } from './materials';
import { groundAt, type WalkArea } from './Walk';

/** Where a bird or butterfly may settle: an island's walkable ground and a few clear spots on it. */
export interface Habitat {
  area: WalkArea;
  /** Island position; the walk area is in island space. */
  origin: THREE.Vector3;
  /** Clear ground in island space. */
  spots: readonly { x: number; z: number }[];
}

/** A bird takes off when anyone comes this close. */
export const FLUSH_DISTANCE = 3.2;
/** And will not land within this distance of anyone. */
const LANDING_CLEARANCE = 7;
/** Birds and butterflies are drawn larger than life so they read next to the chibi characters and tall grass. */
const BIRD_SCALE = 1.8;
const BUTTERFLY_SCALE = 1.4;
/** Take-offs further than this from the player stay silent. */
const EARSHOT = 14;
/** How far from its landing spot a bird hops about. */
const HOP_RANGE = 1.8;

type BirdState = 'ground' | 'flying' | 'away';

interface Bird {
  habitat: number;
  state: BirdState;
  position: THREE.Vector3;
  home: THREE.Vector3;
  yaw: number;
  /** Seconds until the next hop, or until it may come back while away. */
  wait: number;
  hop: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null;
  flight: { from: THREE.Vector3; via: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; landing: boolean } | null;
  peck: number;
  flap: number;
}

interface Butterfly {
  habitat: number;
  home: { x: number; z: number };
  phase: number;
  roam: number;
}

const BIRD_TINTS = ['#9a6b45', '#7d5a3c', '#5d7fb8', '#c49a3a', '#8d8f99'];
const BUTTERFLY_TINTS = ['#ffd166', '#f497b6', '#9fd8ff', '#ffffff', '#ffb067', '#c7a3ff'];

const matrix = new THREE.Matrix4();
const wingMatrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const scale = new THREE.Vector3();
const point = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const shoulder = new THREE.Matrix4();
const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);

function birdBody(): THREE.BufferGeometry {
  const paint = (geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const c = new THREE.Color(color);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const body = new THREE.IcosahedronGeometry(0.1, 0);
  body.scale(0.85, 0.8, 1.25);
  body.translate(0, 0.1, 0);
  const head = new THREE.IcosahedronGeometry(0.068, 0);
  head.translate(0, 0.19, 0.09);
  const beak = new THREE.ConeGeometry(0.022, 0.06, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.185, 0.165);
  const tail = new THREE.BoxGeometry(0.07, 0.015, 0.1);
  tail.rotateX(-0.35);
  tail.translate(0, 0.12, -0.15);
  const merged = mergeGeometries([paint(body, '#ffffff'), paint(head, '#ffffff'), paint(beak, '#2a2622'), paint(tail, '#d8d0c8')], false);
  merged.computeVertexNormals();
  return merged;
}

/** One wing reaching out along +x from the shoulder. */
function birdWing(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.06, 0.17, 0, -0.03, 0, 0, -0.08], 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Two wings hinged on the body's long axis; the vertex shader flaps them. */
function butterflyWings(): THREE.BufferGeometry {
  const w = 0.13;
  // prettier-ignore
  const p = [
    0, 0, 0.09,  w, 0, 0.11,  w * 0.9, 0, -0.05,
    0, 0, 0.09,  w * 0.9, 0, -0.05,  0, 0, -0.07,
    0, 0, 0.09,  -w * 0.9, 0, -0.05,  -w, 0, 0.11,
    0, 0, 0.09,  0, 0, -0.07,  -w * 0.9, 0, -0.05,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return geometry;
}

/**
 * Small life on the islands: birds that hop about and scatter when someone walks up, and
 * butterflies drifting over the grass by day.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly flutter: THREE.InstancedMesh;
  private readonly birds: Bird[] = [];
  private readonly butterflies: Butterfly[] = [];
  private readonly rng: Rng;

  constructor(
    private readonly habitats: readonly Habitat[],
    birdsPerIsland = 5,
    butterfliesPerIsland = 5,
    seed = 4242,
  ) {
    this.rng = mulberry32(seed);
    habitats.forEach((habitat, index) => {
      if (habitat.spots.length === 0) return;
      for (let i = 0; i < birdsPerIsland; i++) {
        const spot = pick(this.rng, habitat.spots);
        const home = this.ground(index, spot.x, spot.z) ?? new THREE.Vector3();
        this.birds.push({
          habitat: index,
          state: 'ground',
          position: home.clone(),
          home,
          yaw: this.rng() * TAU,
          wait: range(this.rng, 0.3, 2),
          hop: null,
          flight: null,
          peck: this.rng() * TAU,
          flap: this.rng() * TAU,
        });
      }
      for (let i = 0; i < butterfliesPerIsland; i++) {
        this.butterflies.push({
          habitat: index,
          home: pick(this.rng, habitat.spots),
          phase: this.rng() * TAU,
          roam: range(this.rng, 1.2, 2.6),
        });
      }
    });

    const birdMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bodies = new THREE.InstancedMesh(birdBody(), birdMaterial, Math.max(1, this.birds.length));
    this.wings = new THREE.InstancedMesh(
      birdWing(),
      new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
      Math.max(1, this.birds.length * 2),
    );
    this.birds.forEach((_, i) => {
      const tint = new THREE.Color(BIRD_TINTS[i % BIRD_TINTS.length]);
      this.bodies.setColorAt(i, tint);
      // Wings a shade darker than the body.
      const wing = tint.clone().multiplyScalar(0.72);
      this.wings.setColorAt(i * 2, wing);
      this.wings.setColorAt(i * 2 + 1, wing);
    });

    const flutterMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    flutterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float flapAngle = 0.25 + 0.95 * (0.5 + 0.5 * sin(uTime * 15.0 + float(gl_InstanceID) * 2.3));
          transformed.x = position.x * cos(flapAngle);
          transformed.y = abs(position.x) * sin(flapAngle);`,
        );
    };
    this.flutter = new THREE.InstancedMesh(butterflyWings(), flutterMaterial, Math.max(1, this.butterflies.length));
    this.butterflies.forEach((_, i) => this.flutter.setColorAt(i, new THREE.Color(BUTTERFLY_TINTS[i % BUTTERFLY_TINTS.length])));

    for (const mesh of [this.bodies, this.wings, this.flutter]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  /** Birds currently on the ground. */
  get grounded(): number {
    return this.birds.filter((bird) => bird.state === 'ground').length;
  }

  /**
   * @param walkers Anyone on foot (the player, islanders); birds keep their distance.
   * @param listener Where the player stands, if on foot.
   * @returns How many birds took off within earshot of the listener this frame.
   */
  update(
    dt: number,
    time: number,
    walkers: readonly THREE.Vector3[],
    weather: { rain: number; night: number },
    listener: THREE.Vector3 | null,
  ): number {
    const sheltering = weather.rain > 0.4;
    let flushed = 0;
    this.birds.forEach((bird, i) => {
      if (this.updateBird(bird, dt, walkers, sheltering) && listener && bird.position.distanceTo(listener) < EARSHOT) flushed++;
      this.drawBird(bird, i, time, weather.night);
    });

    const show = smoothstep(0.45, 0.15, weather.night) * smoothstep(0.5, 0.15, weather.rain);
    this.flutter.visible = show > 0.01;
    if (this.flutter.visible) this.butterflies.forEach((b, i) => this.drawButterfly(b, i, time, show));

    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
    this.flutter.instanceMatrix.needsUpdate = true;
    return flushed;
  }

  /** Returns true when the bird has just taken off. */
  private updateBird(bird: Bird, dt: number, walkers: readonly THREE.Vector3[], sheltering: boolean): boolean {
    if (bird.state === 'ground') {
      const startled = walkers.some((w) => Math.hypot(w.x - bird.position.x, w.z - bird.position.z) < FLUSH_DISTANCE);
      if (startled || sheltering) {
        this.takeOff(bird, walkers);
        return true;
      }
      this.hopAbout(bird, dt);
      return false;
    }

    if (bird.state === 'flying' && bird.flight) {
      const f = bird.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const before = point.copy(bird.position);
      const s = f.landing ? 1 - (1 - f.t) * (1 - f.t) : f.t * f.t; // ease out on landing, in on take-off
      bezier(f.from, f.via, f.to, s, bird.position);
      const dx = bird.position.x - before.x;
      const dz = bird.position.z - before.z;
      if (dx * dx + dz * dz > 1e-8) bird.yaw = Math.atan2(dx, dz);
      if (f.t >= 1) {
        bird.flight = null;
        if (f.landing) {
          bird.state = 'ground';
          bird.home.copy(bird.position);
          bird.wait = range(this.rng, 0.4, 1.5);
        } else {
          bird.state = 'away';
          bird.wait = range(this.rng, 9, 18);
        }
      }
      return false;
    }

    // Away: come back once it is quiet.
    bird.wait -= dt;
    if (bird.wait > 0 || sheltering) return false;
    const landing = this.landingSpot(bird.habitat, walkers);
    if (!landing) {
      bird.wait = 3;
      return false;
    }
    const angle = this.rng() * TAU;
    const from = new THREE.Vector3(landing.x + Math.cos(angle) * 28, landing.y + 16, landing.z + Math.sin(angle) * 28);
    const via = new THREE.Vector3(landing.x + Math.cos(angle) * 6, landing.y + 4, landing.z + Math.sin(angle) * 6);
    bird.position.copy(from);
    bird.flight = { from, via, to: landing, t: 0, duration: range(this.rng, 3.2, 4.4), landing: true };
    bird.state = 'flying';
    return false;
  }

  private takeOff(bird: Bird, walkers: readonly THREE.Vector3[]): void {
    // Away from whoever is closest, with some scatter so a flock fans out.
    let away = this.rng() * TAU;
    let nearest = Infinity;
    for (const w of walkers) {
      const d = Math.hypot(w.x - bird.position.x, w.z - bird.position.z);
      if (d < nearest) {
        nearest = d;
        away = Math.atan2(bird.position.z - w.z, bird.position.x - w.x);
      }
    }
    away += range(this.rng, -0.7, 0.7);
    const from = bird.position.clone();
    const via = from.clone().add(new THREE.Vector3(Math.cos(away) * 4, 3.5, Math.sin(away) * 4));
    const to = from.clone().add(new THREE.Vector3(Math.cos(away) * 34, range(this.rng, 14, 22), Math.sin(away) * 34));
    bird.hop = null;
    bird.flight = { from, via, to, t: 0, duration: range(this.rng, 2.6, 3.4), landing: false };
    bird.state = 'flying';
  }

  private hopAbout(bird: Bird, dt: number): void {
    if (bird.hop) {
      const h = bird.hop;
      h.t = Math.min(1, h.t + dt / 0.22);
      bird.position.lerpVectors(h.from, h.to, h.t);
      bird.position.y += Math.sin(h.t * Math.PI) * 0.16;
      if (h.t >= 1) bird.hop = null;
      return;
    }
    bird.wait -= dt;
    if (bird.wait > 0) return;
    bird.wait = range(this.rng, 0.5, 2.2);
    const angle = this.rng() * TAU;
    const reach = range(this.rng, 0.2, 0.5);
    let x = bird.position.x + Math.cos(angle) * reach;
    let z = bird.position.z + Math.sin(angle) * reach;
    // Drift back towards home rather than wandering off.
    if (Math.hypot(x - bird.home.x, z - bird.home.z) > HOP_RANGE) {
      x = bird.position.x + (bird.home.x - bird.position.x) * 0.3;
      z = bird.position.z + (bird.home.z - bird.position.z) * 0.3;
    }
    const habitat = this.habitats[bird.habitat] as Habitat;
    const to = this.ground(bird.habitat, x - habitat.origin.x, z - habitat.origin.z);
    if (!to || this.inBlocker(bird.habitat, to)) return;
    bird.yaw = Math.atan2(to.x - bird.position.x, to.z - bird.position.z);
    bird.hop = { from: bird.position.clone(), to, t: 0 };
  }

  /** A clear spot well away from everyone, in world space. */
  private landingSpot(habitat: number, walkers: readonly THREE.Vector3[]): THREE.Vector3 | null {
    const spots = (this.habitats[habitat] as Habitat).spots;
    for (let attempt = 0; attempt < 6; attempt++) {
      const spot = pick(this.rng, spots);
      const at = this.ground(habitat, spot.x + range(this.rng, -0.8, 0.8), spot.z + range(this.rng, -0.8, 0.8));
      if (!at || this.inBlocker(habitat, at)) continue;
      if (walkers.every((w) => Math.hypot(w.x - at.x, w.z - at.z) > LANDING_CLEARANCE)) return at;
    }
    return null;
  }

  /** Ground point in world space, or null off the island. */
  private ground(habitat: number, localX: number, localZ: number): THREE.Vector3 | null {
    const h = this.habitats[habitat] as Habitat;
    const y = groundAt(h.area, localX, localZ);
    if (y === null) return null;
    return new THREE.Vector3(localX, y, localZ).add(h.origin);
  }

  private inBlocker(habitat: number, at: THREE.Vector3): boolean {
    const h = this.habitats[habitat] as Habitat;
    const x = at.x - h.origin.x;
    const z = at.z - h.origin.z;
    return h.area.blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 0.12);
  }

  private drawBird(bird: Bird, i: number, time: number, night: number): void {
    if (bird.state === 'away') {
      this.bodies.setMatrixAt(i, hidden);
      this.wings.setMatrixAt(i * 2, hidden);
      this.wings.setMatrixAt(i * 2 + 1, hidden);
      return;
    }
    const flying = bird.state === 'flying';
    // Pecking at the ground between hops; asleep at night.
    const peck = !flying && !bird.hop && night < 0.6 ? Math.max(0, Math.sin(time * 5 + bird.peck)) ** 6 * 0.55 : 0;
    const pitch = flying ? -0.25 : peck;
    quat.setFromEuler(euler.set(pitch, bird.yaw, 0));
    matrix.compose(bird.position, quat, scale.setScalar(BIRD_SCALE));
    this.bodies.setMatrixAt(i, matrix);

    const beat =
      flying ? Math.sin(time * 26 + bird.flap) * 0.9
      : bird.hop ? 0.5
      : -0.1;
    for (const side of [1, -1]) {
      wingMatrix.makeRotationZ(side * beat).premultiply(shoulder.makeTranslation(side * 0.06, 0.13, 0));
      if (side < 0) wingMatrix.multiply(mirror);
      this.wings.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), wingMatrix.premultiply(matrix));
    }
  }

  private drawButterfly(b: Butterfly, i: number, time: number, show: number): void {
    const t = time * 0.55 + b.phase;
    const x = b.home.x + Math.sin(t) * b.roam + Math.sin(t * 2.3) * 0.4;
    const z = b.home.z + Math.cos(t * 0.8) * b.roam + Math.cos(t * 1.7) * 0.4;
    const habitat = this.habitats[b.habitat] as Habitat;
    const y = groundAt(habitat.area, x, z) ?? 0;
    point.set(x, y + 0.55 + Math.sin(time * 3.1 + b.phase) * 0.22, z).add(habitat.origin);
    // Face along the path.
    const dx = Math.cos(t) * b.roam;
    const dz = -Math.sin(t * 0.8) * 0.8 * b.roam;
    quat.setFromEuler(euler.set(0, Math.atan2(dx, dz), 0));
    this.flutter.setMatrixAt(i, matrix.compose(point, quat, scale.setScalar(show * BUTTERFLY_SCALE)));
  }
}

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
}
