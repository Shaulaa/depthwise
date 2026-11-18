import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Tiny modelling kit. Every helper returns a non-indexed geometry carrying only
 * position / normal / color, so any combination can be merged into one draw call.
 */

const color = new THREE.Color();
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const centroid = new THREE.Vector3();

export type Paint = THREE.ColorRepresentation;

export function paint(geometry: THREE.BufferGeometry, c: Paint): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  color.set(c);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return geometry;
}

/** Recolour each triangle from its centroid. */
export function paintFaces(
  geometry: THREE.BufferGeometry,
  pickColor: (centroid: THREE.Vector3, face: number) => Paint,
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const col = geometry.getAttribute('color');
  for (let i = 0; i < pos.count; i += 3) {
    centroid.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      centroid.x += pos.getX(i + k) / 3;
      centroid.y += pos.getY(i + k) / 3;
      centroid.z += pos.getZ(i + k) / 3;
    }
    color.set(pickColor(centroid, i / 3));
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, color.r, color.g, color.b);
  }
  col.needsUpdate = true;
  return geometry;
}

function prep(source: THREE.BufferGeometry, c: Paint, smooth: boolean): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.deleteAttribute('uv');
  if (!smooth) geometry.computeVertexNormals(); // per-face normals on non-indexed geometry
  return paint(geometry, c);
}

export const box = (w: number, h: number, d: number, c: Paint): THREE.BufferGeometry =>
  prep(new THREE.BoxGeometry(w, h, d), c, false);

export const cyl = (rTop: number, rBottom: number, h: number, sides: number, c: Paint, smooth = false): THREE.BufferGeometry =>
  prep(new THREE.CylinderGeometry(rTop, rBottom, h, sides), c, smooth);

export const cone = (r: number, h: number, sides: number, c: Paint): THREE.BufferGeometry =>
  prep(new THREE.ConeGeometry(r, h, sides), c, false);

export const ico = (r: number, detail: number, c: Paint, smooth = false): THREE.BufferGeometry =>
  prep(new THREE.IcosahedronGeometry(r, detail), c, smooth);

/** Upper half of a sphere, used for domes and mushroom caps. */
export const dome = (r: number, sides: number, c: Paint): THREE.BufferGeometry =>
  prep(new THREE.SphereGeometry(r, sides, 4, 0, Math.PI * 2, 0, Math.PI / 2), c, false);

export interface Transform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Uniform scale; per-axis values override it. */
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/** Scale, then rotate (Y, X, Z order), then translate. Mutates and returns the geometry. */
export function xf(geometry: THREE.BufferGeometry, t: Transform): THREE.BufferGeometry {
  euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'YXZ');
  quat.setFromEuler(euler);
  position.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  const s = t.s ?? 1;
  scale.set(t.sx ?? s, t.sy ?? s, t.sz ?? s);
  geometry.applyMatrix4(matrix.compose(position, quat, scale));
  return geometry;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Could not merge geometries: attribute sets differ.');
  for (const part of parts) part.dispose();
  return merged;
}

/** Collects pieces and bakes them into a single mesh. */
export class Batch {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, t?: Transform): this {
    this.parts.push(t ? xf(geometry, t) : geometry);
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Merged geometry, for callers that need to transform or re-batch it. */
  geometry(): THREE.BufferGeometry {
    return merge(this.parts.splice(0));
  }

  mesh(material: THREE.Material, shadows = true): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(), material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }
}
