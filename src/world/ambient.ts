import * as THREE from 'three';
import { TAU, mulberry32, range, smoothstep } from '../core/math';
import { lampGlow, shared } from './materials';

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();

/** Loose flocks circling the archipelago. Wings flap in the vertex shader. */
export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private readonly birds: { flock: number; offset: THREE.Vector3; wobble: number }[] = [];
  private readonly flocks: { radius: number; height: number; speed: number; angle: number }[] = [];

  constructor() {
    const rng = mulberry32(404);
    for (let f = 0; f < 3; f++) {
      this.flocks.push({
        radius: range(rng, 95, 190),
        height: range(rng, 34, 78),
        speed: range(rng, 0.035, 0.06) * (f % 2 ? -1 : 1),
        angle: rng() * TAU,
      });
      const size = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < size; i++) {
        // V formation trailing behind the leader.
        const row = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        this.birds.push({
          flock: f,
          offset: new THREE.Vector3(side * row * 2.4, range(rng, -0.6, 0.6), -row * 2.6),
          wobble: rng() * TAU,
        });
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0.42, 0, 0, -0.3, -1.25, 0, -0.12, 0, 0, 0.42, 1.25, 0, -0.12, 0, 0, -0.3], 3),
    );
    const material = new THREE.MeshBasicMaterial({ color: '#1e2540', side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.y += abs(position.x) * sin(uTime * 7.0 + float(gl_InstanceID) * 1.9) * 0.6;`,
        );
    };
    this.mesh = new THREE.InstancedMesh(geometry, material, this.birds.length);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, time: number): void {
    for (const flock of this.flocks) flock.angle += flock.speed * dt;
    this.birds.forEach((bird, i) => {
      const flock = this.flocks[bird.flock] as (typeof this.flocks)[number];
      const direction = Math.sign(flock.speed);
      // Heading is the tangent of the flock's circle.
      const yaw = Math.atan2(-Math.sin(flock.angle) * direction, Math.cos(flock.angle) * direction);
      quat.setFromEuler(euler.set(0, yaw, 0));
      position.copy(bird.offset).applyQuaternion(quat);
      position.x += Math.cos(flock.angle) * flock.radius;
      position.z += Math.sin(flock.angle) * flock.radius;
      position.y += flock.height + Math.sin(time * 0.7 + bird.wobble) * 0.8;
      this.mesh.setMatrixAt(i, matrix.compose(position, quat, scale.setScalar(1)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const FIREFLY_VERTEX = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.6 + aSeed.x * 6.283) * 0.9;
    p.y += sin(uTime * 0.9 + aSeed.y * 6.283) * 0.5;
    p.z += cos(uTime * 0.5 + aSeed.z * 6.283) * 0.9;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vAlpha = smoothstep(0.15, 1.0, sin(uTime * 1.4 + aSeed.x * 31.0) * 0.5 + 0.5);
    gl_PointSize = (0.3 + aSeed.y * 0.2) * uPixelRatio * (520.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FIREFLY_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float glow = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.82, 1.0, 0.42) * 2.6, glow * glow * vAlpha * uOpacity);
  }
`;

/** Glowing motes that come out as the light fades. */
export class Fireflies {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(spots: readonly THREE.Vector3[], pixelRatio: number) {
    const rng = mulberry32(909);
    const positions = new Float32Array(spots.length * 3);
    const seeds = new Float32Array(spots.length * 3);
    spots.forEach((spot, i) => {
      positions.set([spot.x, spot.y + range(rng, 0.6, 3.6), spot.z], i * 3);
      seeds.set([rng(), rng(), rng()], i * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: FIREFLY_VERTEX,
      fragmentShader: FIREFLY_FRAGMENT,
      uniforms: { uTime: shared.time, uOpacity: { value: 0 }, uPixelRatio: { value: pixelRatio } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geometry, this.material);
  }

  update(night: number): void {
    const opacity = smoothstep(0.25, 0.8, night);
    this.material.uniforms.uOpacity!.value = opacity;
    this.points.visible = opacity > 0.01;
  }
}

/** Paper lanterns that drift up from the hill after dusk. */
export class PaperLanterns {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: { x: number; z: number; phase: number; speed: number; sway: number }[] = [];
  private readonly rise = 30;

  constructor(radius: number, count = 34) {
    const rng = mulberry32(515);
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU;
      const r = Math.sqrt(rng()) * radius;
      this.items.push({
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        phase: rng(),
        speed: range(rng, 0.018, 0.034),
        sway: rng() * TAU,
      });
    }
    const geometry = new THREE.CylinderGeometry(0.2, 0.15, 0.44, 6);
    this.mesh = new THREE.InstancedMesh(geometry, lampGlow, count);
    this.mesh.frustumCulled = false;
  }

  update(time: number, night: number): void {
    const show = smoothstep(0.4, 0.85, night);
    this.mesh.visible = show > 0.01;
    if (!this.mesh.visible) return;
    quat.identity();
    this.items.forEach((item, i) => {
      const lift = (time * item.speed + item.phase) % 1;
      // Fade in off the ground and out again at the top of the climb.
      const fade = smoothstep(0, 0.08, lift) * smoothstep(1, 0.8, lift) * show;
      position.set(
        item.x + Math.sin(time * 0.4 + item.sway) * 0.9,
        2 + lift * this.rise,
        item.z + Math.cos(time * 0.33 + item.sway) * 0.9,
      );
      this.mesh.setMatrixAt(i, matrix.compose(position, quat, scale.setScalar(Math.max(fade, 0.0001))));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const BURST_SIZE = 110;

/** Soft round dot, so sparks read as points of light rather than square pixels. */
function sparkTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const glow = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

interface Burst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  age: number;
  life: number;
}

/** Pooled particle bursts for wins and the finale. */
export class Fireworks {
  readonly group = new THREE.Group();
  private readonly pool: Burst[] = [];
  private readonly rng = mulberry32(31337);

  constructor(pixelRatio: number, poolSize = 8) {
    const map = sparkTexture();
    for (let i = 0; i < poolSize; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_SIZE * 3), 3));
      const material = new THREE.PointsMaterial({
        map,
        size: 6 * pixelRatio,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const points = new THREE.Points(geometry, material);
      points.visible = false;
      points.frustumCulled = false;
      this.group.add(points);
      this.pool.push({ points, material, velocities: new Float32Array(BURST_SIZE * 3), age: 0, life: 0 });
    }
  }

  /** Fire one burst. Reuses the oldest slot when the pool is busy. */
  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, power = 15): void {
    const slot = this.pool.find((b) => !b.points.visible) ?? this.pool.reduce((a, b) => (a.age > b.age ? a : b));
    const positions = slot.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < BURST_SIZE; i++) {
      // Uniform direction on a sphere, with uneven speed for a fuller shell.
      const u = this.rng() * 2 - 1;
      const phi = this.rng() * TAU;
      const ring = Math.sqrt(1 - u * u);
      const speed = power * (0.55 + this.rng() * 0.45);
      slot.velocities.set([ring * Math.cos(phi) * speed, u * speed, ring * Math.sin(phi) * speed], i * 3);
      positions.setXYZ(i, at.x, at.y, at.z);
    }
    positions.needsUpdate = true;
    // Pushed into HDR so the bloom pass turns each spark into a glow.
    slot.material.color.set(color).multiplyScalar(3);
    slot.material.opacity = 1;
    slot.age = 0;
    slot.life = 2.1;
    slot.points.visible = true;
  }

  update(dt: number): void {
    for (const slot of this.pool) {
      if (!slot.points.visible) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.points.visible = false;
        continue;
      }
      const positions = slot.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const data = positions.array as Float32Array;
      const drag = Math.exp(-1.5 * dt);
      for (let i = 0; i < BURST_SIZE * 3; i += 3) {
        slot.velocities[i] = (slot.velocities[i] as number) * drag;
        slot.velocities[i + 1] = (slot.velocities[i + 1] as number) * drag - 5.5 * dt;
        slot.velocities[i + 2] = (slot.velocities[i + 2] as number) * drag;
        data[i] = (data[i] as number) + (slot.velocities[i] as number) * dt;
        data[i + 1] = (data[i + 1] as number) + (slot.velocities[i + 1] as number) * dt;
        data[i + 2] = (data[i + 2] as number) + (slot.velocities[i + 2] as number) * dt;
      }
      positions.needsUpdate = true;
      slot.material.opacity = smoothstep(1, 0.45, slot.age / slot.life);
    }
  }
}
