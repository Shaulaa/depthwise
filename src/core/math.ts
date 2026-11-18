export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const saturate = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite step. Works with reversed edges (edge0 > edge1) to produce a falling ramp. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing towards a target. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Signed shortest rotation from one angle to another, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export type Rng = () => number;

/** Small, fast, seedable PRNG so the world is identical on every load. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

export type Noise2D = (x: number, y: number) => number;

/** Seeded value noise in [0, 1]. */
export function makeNoise2D(seed: number): Noise2D {
  const rng = mulberry32(seed);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255] as number;
  for (let i = 0; i < 256; i++) values[i] = rng();

  const at = (x: number, y: number): number => values[perm[x + (perm[y] as number)] as number] as number;
  const fade = (t: number): number => t * t * (3 - 2 * t);

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const X = xi & 255;
    const Y = yi & 255;
    return lerp(lerp(at(X, Y), at(X + 1, Y), u), lerp(at(X, Y + 1), at(X + 1, Y + 1), u), v);
  };
}

/** Fractal noise in [0, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
