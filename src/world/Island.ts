import * as THREE from 'three';
import { TAU, fbm, lerp, makeNoise2D, mulberry32, saturate, smoothstep, type Noise2D, type Rng } from '../core/math';
import { solidMat } from './materials';

export interface Bump {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** A levelled patch, optionally paved. */
export interface Flat {
  x: number;
  z: number;
  r: number;
  y: number;
  color?: string;
}

export interface Pit {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export interface IslandPalette {
  grassA: string;
  grassB: string;
  sand: string;
  soil: string;
  cliff: string;
  rockA: string;
  rockB: string;
  snow?: string;
}

export interface IslandShape {
  seed: number;
  radius: number;
  /** How far the underside hangs below the rim. */
  depth: number;
  /** Height of the inland plateau above the rim. */
  plateau: number;
  /** Amplitude of rolling hills. */
  hills: number;
  lobes?: number;
  bumps?: Bump[];
  flats?: Flat[];
  pits?: Pit[];
  snowLine?: number;
  rings?: number;
  segments?: number;
  palette: IslandPalette;
}

export interface PlaceOptions {
  /** Keep this fraction of the radius clear at the rim. */
  margin?: number;
  /** Minimum surface normal Y; 1 is perfectly flat. */
  minFlatness?: number;
  /** Extra clearance around flats and pits. */
  pad?: number;
  maxY?: number;
  /** Circles to stay out of. */
  avoid?: readonly { x: number; z: number; r: number }[];
  /** Minimum spacing between scattered points. */
  spacing?: number;
}

type Face = 'top' | 'side' | 'under';

/**
 * A floating island: an analytic height field on top, an inverted rocky mountain underneath.
 * Local space has the rim at y = 0 and the island centred on the origin.
 */
export class Island {
  readonly mesh: THREE.Mesh;
  private readonly noise: Noise2D;
  private readonly phases: [number, number, number];
  private readonly cliff: number;

  constructor(readonly shape: IslandShape) {
    const rng = mulberry32(shape.seed);
    this.noise = makeNoise2D(shape.seed * 13 + 5);
    this.phases = [rng() * TAU, rng() * TAU, rng() * TAU];
    this.cliff = 1.3 + shape.radius * 0.035;
    this.mesh = new THREE.Mesh(this.build(rng), solidMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Distance from the centre to the rim along an angle. Never a perfect circle. */
  rimRadius(theta: number): number {
    const lobes = this.shape.lobes ?? 3;
    const [a, b, c] = this.phases;
    return (
      this.shape.radius *
      (1 +
        0.085 * Math.sin(theta * lobes + a) +
        0.05 * Math.sin(theta * (lobes * 2 + 1) + b) +
        0.028 * Math.sin(theta * (lobes * 4 + 3) + c))
    );
  }

  /** Ground height in local space; 0 at and beyond the rim. */
  heightAt(x: number, z: number): number {
    const s = this.shape;
    const d = Math.hypot(x, z) / this.rimRadius(Math.atan2(z, x));
    if (d >= 1) return 0;

    let h = s.plateau * smoothstep(1, 0.74, d);
    h += s.hills * (fbm(this.noise, x * 0.07 + 31.7, z * 0.07 + 12.3, 3) - 0.35) * smoothstep(0.98, 0.55, d);

    if (s.bumps) {
      const guard = smoothstep(1, 0.88, d);
      for (const b of s.bumps) {
        h += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r)) * guard;
      }
    }
    if (s.pits) {
      for (const p of s.pits) h -= p.depth * smoothstep(p.r, p.r * 0.45, Math.hypot(x - p.x, z - p.z));
    }
    if (s.flats) {
      for (const f of s.flats) h = lerp(h, f.y, smoothstep(f.r * 1.35, f.r, Math.hypot(x - f.x, z - f.z)));
    }
    return h;
  }

  /** Y component of the surface normal: 1 on level ground, lower on slopes. */
  flatnessAt(x: number, z: number): number {
    const e = 0.4;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Point on the ground at a given angle, `inset` units in from the rim. */
  rimPoint(theta: number, inset = 0, target = new THREE.Vector3()): THREE.Vector3 {
    const r = this.rimRadius(theta) - inset;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    return target.set(x, this.heightAt(x, z), z);
  }

  canPlace(x: number, z: number, opts: PlaceOptions = {}): boolean {
    const s = this.shape;
    const pad = opts.pad ?? 0;
    const d = Math.hypot(x, z) / this.rimRadius(Math.atan2(z, x));
    if (d > 1 - (opts.margin ?? 0.08)) return false;
    if (s.flats?.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 0.6 + pad)) return false;
    if (s.pits?.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.5 + pad)) return false;
    if (opts.avoid?.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + pad)) return false;
    if (opts.maxY !== undefined && this.heightAt(x, z) > opts.maxY) return false;
    return this.flatnessAt(x, z) >= (opts.minFlatness ?? 0.8);
  }

  /** Rejection-sample ground points. May return fewer than requested on a crowded island. */
  scatter(rng: Rng, count: number, opts: PlaceOptions = {}): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const reach = this.shape.radius * 1.15;
    const spacingSq = (opts.spacing ?? 0) ** 2;
    for (let tries = 0; tries < count * 40 && points.length < count; tries++) {
      const theta = rng() * TAU;
      const r = Math.sqrt(rng()) * reach;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      if (!this.canPlace(x, z, opts)) continue;
      if (spacingSq > 0 && points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < spacingSq)) continue;
      points.push(new THREE.Vector3(x, this.heightAt(x, z), z));
    }
    return points;
  }

  /** Height of the rocky underside at a point: always a negative Y. */
  underAt(x: number, z: number): number {
    const s = this.shape;
    const d = Math.min(1, Math.hypot(x, z) / this.rimRadius(Math.atan2(z, x)));
    const body = Math.pow(1 - d, 1.2);
    const lumps = fbm(this.noise, x * 0.09 + 80, z * 0.09 + 40, 3);
    const spike = Math.pow(this.noise(x * 0.21 + 7, z * 0.21 + 19), 3) * Math.sqrt(1 - d);
    return -(this.cliff + s.depth * body * (0.7 + 0.6 * lumps) + s.depth * 0.5 * spike);
  }

  private build(rng: Rng): THREE.BufferGeometry {
    const s = this.shape;
    const rings = s.rings ?? 16;
    const segments = s.segments ?? 72;
    const underRings = Math.max(4, Math.round(rings * 0.6));
    const inset = 0.94;

    const ringPoint = (ring: number, total: number, j: number, jitter: boolean): { x: number; z: number } => {
      const jt = jitter ? 1 : 0;
      const theta = ((j + (rng() - 0.5) * 0.55 * jt) / segments) * TAU;
      const d = (ring + (rng() - 0.5) * 0.45 * jt) / total;
      const r = this.rimRadius(theta) * d;
      return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
    };

    const top: THREE.Vector3[][] = [];
    for (let i = 1; i <= rings; i++) {
      const ring: THREE.Vector3[] = [];
      for (let j = 0; j < segments; j++) {
        const { x, z } = ringPoint(i, rings, j, i < rings);
        ring.push(new THREE.Vector3(x, i === rings ? 0 : this.heightAt(x, z), z));
      }
      top.push(ring);
    }

    const under: THREE.Vector3[][] = [];
    for (let i = 1; i <= underRings; i++) {
      const ring: THREE.Vector3[] = [];
      for (let j = 0; j < segments; j++) {
        const { x, z } = ringPoint(i, underRings, j, i < underRings);
        ring.push(new THREE.Vector3(x * inset, this.underAt(x, z), z * inset));
      }
      under.push(ring);
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const center = new THREE.Vector3();
    const tint = new THREE.Color();

    // Winding is fixed up per triangle, so callers never have to think about vertex order.
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, face: Face): void => {
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (normal.lengthSq() < 1e-12) return;
      normal.normalize();
      center.copy(a).add(b).add(c).divideScalar(3);
      const outward = face === 'top' ? normal.y : face === 'under' ? -normal.y : normal.x * center.x + normal.z * center.z;
      let p1 = b;
      let p2 = c;
      if (outward < 0) {
        normal.negate();
        p1 = c;
        p2 = b;
      }
      this.faceColor(face, center, normal, rng, tint);
      positions.push(a.x, a.y, a.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      for (let k = 0; k < 3; k++) {
        normals.push(normal.x, normal.y, normal.z);
        colors.push(tint.r, tint.g, tint.b);
      }
    };

    const skin = (apex: THREE.Vector3, ringsOf: THREE.Vector3[][], face: Face): void => {
      const first = ringsOf[0] as THREE.Vector3[];
      for (let j = 0; j < segments; j++) {
        tri(apex, first[j] as THREE.Vector3, first[(j + 1) % segments] as THREE.Vector3, face);
      }
      for (let i = 0; i < ringsOf.length - 1; i++) {
        const inner = ringsOf[i] as THREE.Vector3[];
        const outer = ringsOf[i + 1] as THREE.Vector3[];
        for (let j = 0; j < segments; j++) {
          const j1 = (j + 1) % segments;
          const a = inner[j] as THREE.Vector3;
          const b = inner[j1] as THREE.Vector3;
          const c = outer[j] as THREE.Vector3;
          const d = outer[j1] as THREE.Vector3;
          // Flip the quad diagonal at random to break up the radial grid.
          if (rng() < 0.5) {
            tri(a, b, c, face);
            tri(b, d, c, face);
          } else {
            tri(a, b, d, face);
            tri(a, d, c, face);
          }
        }
      }
    };

    skin(new THREE.Vector3(0, this.heightAt(0, 0), 0), top, 'top');
    skin(new THREE.Vector3(0, this.underAt(0, 0), 0), under, 'under');

    const rimTop = top[top.length - 1] as THREE.Vector3[];
    const rimUnder = under[under.length - 1] as THREE.Vector3[];
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      tri(rimTop[j] as THREE.Vector3, rimTop[j1] as THREE.Vector3, rimUnder[j] as THREE.Vector3, 'side');
      tri(rimTop[j1] as THREE.Vector3, rimUnder[j1] as THREE.Vector3, rimUnder[j] as THREE.Vector3, 'side');
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private readonly scratch = new THREE.Color();

  private faceColor(face: Face, center: THREE.Vector3, normal: THREE.Vector3, rng: Rng, out: THREE.Color): void {
    const s = this.shape;
    const p = s.palette;
    const { x, y, z } = center;

    if (face === 'top') {
      const d = Math.hypot(x, z) / this.rimRadius(Math.atan2(z, x));
      const paved = s.flats?.find((f) => f.color && Math.hypot(x - f.x, z - f.z) < f.r * 1.04);
      const wet = s.pits?.some((pit) => Math.hypot(x - pit.x, z - pit.z) < pit.r * 0.92);
      if (paved?.color) out.set(paved.color);
      else if (wet) out.set(p.sand);
      else if (normal.y < 0.78) out.set(p.cliff);
      else if (s.snowLine !== undefined && y > s.snowLine) out.set(p.snow ?? '#f4f7fb');
      else {
        const patch = fbm(this.noise, x * 0.13 + 3, z * 0.13 + 9, 2);
        out.set(p.grassA).lerp(this.scratch.set(p.grassB), smoothstep(0.35, 0.65, patch));
        out.lerp(this.scratch.set(p.sand), smoothstep(0.9, 0.98, d));
      }
    } else if (face === 'side') {
      out.set(p.soil).lerp(this.scratch.set(p.cliff), smoothstep(-0.3, -this.cliff, y));
    } else {
      const depth = saturate(-y / (s.depth + this.cliff));
      const vein = this.noise(x * 0.3 + 50, z * 0.3 + 70);
      out.set(p.rockA).lerp(this.scratch.set(p.rockB), saturate(depth * 0.85 + (vein - 0.5) * 0.5));
    }
    out.multiplyScalar(0.93 + rng() * 0.14);
  }
}
