import * as THREE from 'three';
import type { DayNight } from '../core/DayNight';
import { clamp, damp, mulberry32, smoothstep, type Rng } from '../core/math';
import { shared } from './materials';

export type WeatherKind = 'cerah' | 'mendung' | 'hujan' | 'kabut';
export const WEATHER_KINDS: readonly WeatherKind[] = ['cerah', 'mendung', 'hujan', 'kabut'];

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && (WEATHER_KINDS as readonly string[]).includes(value);
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  cerah: 'Cerah',
  mendung: 'Mendung',
  hujan: 'Hujan',
  kabut: 'Berkabut',
};

/** How much of each ingredient a kind of weather is made of, 0..1. */
export interface WeatherMix {
  cloud: number;
  rain: number;
  mist: number;
}

const MIX: Record<WeatherKind, WeatherMix> = {
  cerah: { cloud: 0, rain: 0, mist: 0 },
  mendung: { cloud: 0.7, rain: 0, mist: 0.15 },
  hujan: { cloud: 1, rain: 1, mist: 0.35 },
  kabut: { cloud: 0.3, rain: 0, mist: 1 },
};

/** What can follow each kind, with weights. Clear skies come back most often. */
const NEXT: Record<WeatherKind, readonly [WeatherKind, number][]> = {
  cerah: [
    ['mendung', 3],
    ['kabut', 1],
  ],
  mendung: [
    ['hujan', 2],
    ['cerah', 2],
  ],
  hujan: [
    ['cerah', 3],
    ['mendung', 1],
  ],
  kabut: [['cerah', 1]],
};

/** Seconds each kind lasts, min and max. */
const DURATION: Record<WeatherKind, readonly [number, number]> = {
  cerah: [150, 260],
  mendung: [60, 110],
  hujan: [70, 120],
  kabut: [60, 100],
};

/** Seconds a rainbow hangs around after the rain stops. */
export const RAINBOW_TIME = 50;
/** How quickly the mix eases towards a new kind of weather (per second). */
const BLEND = 0.18;

/**
 * Picks the weather and eases its ingredients over time. Pure logic, no rendering, so it can be
 * tested and driven from anywhere.
 */
export class WeatherCycle {
  kind: WeatherKind;
  /** Current, eased ingredient levels. */
  readonly level: WeatherMix = { cloud: 0, rain: 0, mist: 0 };
  /** 0..1, eased. Shows after rain gives way to clearer skies. */
  rainbow = 0;
  /** When set, the weather stays as it is. */
  locked = false;
  private left: number;
  private rainbowLeft = 0;

  constructor(
    private readonly rng: Rng = Math.random,
    start: WeatherKind = 'cerah',
  ) {
    this.kind = start;
    this.left = this.duration(start);
    Object.assign(this.level, MIX[start]);
  }

  /** True for a while after rain clears, while a rainbow may show. */
  get rainbowDue(): boolean {
    return this.rainbowLeft > 0;
  }

  /** Switch to a kind of weather now. The look still eases over unless `instant`. */
  set(kind: WeatherKind, instant = false): void {
    if (this.kind === 'hujan' && kind !== 'hujan') this.rainbowLeft = RAINBOW_TIME;
    this.kind = kind;
    this.left = this.duration(kind);
    if (instant) {
      Object.assign(this.level, MIX[kind]);
      if (kind === 'hujan') this.rainbowLeft = 0;
    }
  }

  /** Returns the new kind when the weather changes on its own, otherwise null. */
  update(dt: number): WeatherKind | null {
    let changed: WeatherKind | null = null;
    if (!this.locked) {
      this.left -= dt;
      if (this.left <= 0) {
        changed = this.pickNext();
        this.set(changed);
      }
    }

    const target = MIX[this.kind];
    this.level.cloud = damp(this.level.cloud, target.cloud, BLEND, dt);
    this.level.rain = damp(this.level.rain, target.rain, BLEND * 1.4, dt);
    this.level.mist = damp(this.level.mist, target.mist, BLEND, dt);

    this.rainbowLeft = Math.max(0, this.rainbowLeft - dt);
    const showRainbow = this.rainbowLeft > 0 && this.level.rain < 0.35 ? 1 : 0;
    this.rainbow = damp(this.rainbow, showRainbow, 0.5, dt);
    return changed;
  }

  private pickNext(): WeatherKind {
    const options = NEXT[this.kind];
    const total = options.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.rng() * total;
    for (const [kind, weight] of options) {
      roll -= weight;
      if (roll < 0) return kind;
    }
    return (options[options.length - 1] as [WeatherKind, number])[0];
  }

  private duration(kind: WeatherKind): number {
    const [min, max] = DURATION[kind];
    return min + (max - min) * this.rng();
  }
}

// ------------------------------------------------------------------ rendering

/** Rain streaks live in a box that follows the camera and wraps, so they never run out. */
const RAIN_BOX = new THREE.Vector3(70, 46, 70);

const RAIN_VERTEX = /* glsl */ `
  attribute float aEnd;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  varying float vAlpha;
  void main() {
    vec3 p = position * uBox;
    float speed = 30.0 + fract(position.x * 37.0) * 10.0;
    p.y -= uTime * speed;
    p.x -= uTime * speed * 0.08;
    // Wrap the drop's head into the box around the camera; the tail follows the head.
    vec3 corner = uCenter - uBox * 0.5;
    p = mod(p - corner, uBox) + corner;
    p += aEnd * vec3(0.1, -1.3, 0.0);
    vec2 offset = (p.xz - uCenter.xz) / (uBox.xz * 0.5);
    vAlpha = (1.0 - smoothstep(0.55, 1.0, length(offset))) * mix(0.15, 1.0, aEnd);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  }
`;

const RAINBOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RAINBOW_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 q = vec2(vUv.x * 2.0 - 1.0, vUv.y);
    float r = length(q);
    // 0 on the inner (violet) edge, 1 on the outer (red) edge.
    float band = (r - 0.8) / 0.12;
    if (band < 0.0 || band > 1.0) discard;
    vec3 color = clamp(abs(mod((1.0 - band) * 0.8 * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    color = mix(vec3(1.0), color, 0.92);
    float edge = smoothstep(0.0, 0.2, band) * smoothstep(1.0, 0.75, band);
    // Rises out of the haze rather than starting at a hard line.
    float foot = smoothstep(0.0, 0.35, q.y);
    gl_FragColor = vec4(color, edge * foot * uOpacity);
  }
`;

/** How far off the rainbow hangs, well inside the sky dome. */
const RAINBOW_DISTANCE = 1100;
const BASE_FOG = 0.0011;

const grey = new THREE.Color();
const scratch = new THREE.Vector3();

/** Rain, mist and the rainbow, plus the grey wash weather puts over the day's colours. */
export class Weather {
  readonly cycle: WeatherCycle;
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly rainMaterial: THREE.ShaderMaterial;
  private readonly rainbow: THREE.Mesh;
  private readonly rainbowMaterial: THREE.ShaderMaterial;

  constructor(dropCount: number, rng: Rng = mulberry32(Date.now() & 0xffff)) {
    this.cycle = new WeatherCycle(rng);

    const positions = new Float32Array(dropCount * 6);
    const ends = new Float32Array(dropCount * 2);
    const seed = mulberry32(8080);
    for (let i = 0; i < dropCount; i++) {
      const x = seed();
      const y = seed();
      const z = seed();
      positions.set([x, y, z, x, y, z], i * 6);
      ends.set([0, 1], i * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainMaterial = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: {
        uTime: shared.time,
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: RAIN_BOX },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.rain = new THREE.LineSegments(geometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;

    this.rainbowMaterial = new THREE.ShaderMaterial({
      vertexShader: RAINBOW_VERTEX,
      fragmentShader: RAINBOW_FRAGMENT,
      uniforms: { uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    // A plane twice as wide as tall; the shader cuts the arc out of it.
    const arc = new THREE.PlaneGeometry(2, 1, 1, 1);
    arc.translate(0, 0.5, 0);
    this.rainbow = new THREE.Mesh(arc, this.rainbowMaterial);
    this.rainbow.frustumCulled = false;
    this.rainbow.visible = false;
    this.rainbow.renderOrder = -10;

    this.group.add(this.rain, this.rainbow);
  }

  get kind(): WeatherKind {
    return this.cycle.kind;
  }

  /** How open the sky is, 0..1. Dims the sun, moon and stars. */
  get clearSky(): number {
    return 1 - this.cycle.level.cloud * 0.9;
  }

  /** Advance the weather. Returns the new kind when it changed on its own. */
  update(dt: number): WeatherKind | null {
    return this.cycle.update(dt);
  }

  /** Wash the day's colours and light with the current weather. Call after `day.update`. */
  apply(day: DayNight): void {
    const { cloud, rain, mist } = this.cycle.level;
    const gloom = cloud * 0.6 + rain * 0.15;
    if (gloom > 0.001 || mist > 0.001) {
      for (const color of [day.top, day.horizon, day.fog, day.hemiSky, day.waterDeep, day.waterShallow]) {
        const l = color.r * 0.3 + color.g * 0.55 + color.b * 0.15;
        // Overcast: grey and a little darker. Mist: pale, but never brighter than the light allows.
        grey.setRGB(l, l * 1.02, l * 1.06).multiplyScalar(0.82);
        color.lerp(grey, gloom);
      }
      const veil = mist * 0.7 + rain * 0.2;
      day.top.lerp(day.fog, veil * 0.75);
      day.horizon.lerp(day.fog, veil);
    }
    day.lightIntensity *= 1 - cloud * 0.72;
    day.hemiIntensity *= 1 - cloud * 0.12;
    day.sunVisibility *= 1 - cloud * 0.95;
  }

  /** Fog density for the scene: thin on clear days, thick in mist. */
  get fogDensity(): number {
    const { rain, mist } = this.cycle.level;
    return BASE_FOG + mist * 0.0042 + rain * 0.0014;
  }

  /** Move the rain with the camera and hang the rainbow opposite the sun. */
  place(camera: THREE.Camera, day: DayNight): void {
    const { rain } = this.cycle.level;
    const rainOpacity = smoothstep(0.05, 0.6, rain) * 0.55;
    this.rain.visible = rainOpacity > 0.01;
    if (this.rain.visible) {
      const u = this.rainMaterial.uniforms as Record<string, THREE.IUniform>;
      (u.uCenter!.value as THREE.Vector3).copy(camera.position);
      u.uOpacity!.value = rainOpacity;
      (u.uColor!.value as THREE.Color).copy(day.fog).lerp(grey.set('#ffffff'), 0.45).multiplyScalar(0.6 + (1 - day.night) * 0.6);
    }

    // Rainbows need the sun behind you.
    const opacity = this.cycle.rainbow * (1 - day.night) * smoothstep(-0.02, 0.12, day.sunDir.y) * 0.5;
    this.rainbow.visible = opacity > 0.005;
    if (!this.rainbow.visible) return;
    this.rainbowMaterial.uniforms.uOpacity!.value = opacity;
    scratch.set(-day.sunDir.x, 0, -day.sunDir.z);
    if (scratch.lengthSq() < 1e-4) scratch.set(0, 0, 1);
    scratch.normalize();
    // The sun is also treated as low, so the arc always stands well clear of the horizon.
    const sunHeight = clamp(Math.asin(clamp(day.sunDir.y, -1, 1)), 0, 0.3);
    // Stylised: a tighter arc than the real 42 degrees, so the whole bow fits in view.
    const radius = RAINBOW_DISTANCE * Math.tan(0.42);
    this.rainbow.position.copy(camera.position).addScaledVector(scratch, RAINBOW_DISTANCE);
    this.rainbow.position.y -= RAINBOW_DISTANCE * Math.tan(sunHeight) + radius * 0.15;
    this.rainbow.scale.setScalar(radius);
    this.rainbow.lookAt(camera.position.x, this.rainbow.position.y, camera.position.z);
  }
}
