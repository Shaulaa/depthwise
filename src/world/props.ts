import * as THREE from 'three';
import { TAU, lerp } from '../core/math';
import { Batch, box, cone, cyl, dome, ico, merge, xf, type Paint, type Transform } from './geo';
import { solidMat } from './materials';

/** One batch per material, so a whole island's props bake down to a handful of meshes. */
export interface Kit {
  solid: Batch;
  window: Batch;
  lamp: Batch;
  spore: Batch;
}

const KIT_KEYS = ['solid', 'window', 'lamp', 'spore'] as const;

export const newKit = (): Kit => ({ solid: new Batch(), window: new Batch(), lamp: new Batch(), spore: new Batch() });

/** Bake a locally-built kit into another one at a transform. */
function stamp(into: Kit, local: Kit, t: Transform): void {
  for (const key of KIT_KEYS) if (!local[key].empty) into[key].add(local[key].geometry(), t);
}

const STONE = '#b9b1a2';
const STONE_DARK = '#8f887c';
const WOOD = '#8a5d3f';
const WOOD_DARK = '#63432f';
const IRON = '#2c3046';
const GLASS = '#ffffff';

export interface HouseOptions {
  w: number;
  d: number;
  h: number;
  wall: Paint;
  roof: Paint;
  chimney?: boolean;
}

/** Gabled cottage facing +z. The foundation runs below ground to hide uneven terrain. */
export function house(into: Kit, t: Transform, o: HouseOptions): void {
  const k = newKit();
  const roofH = o.w * 0.5;
  const roof = cyl(1, 1, o.d + 0.7, 3, o.roof);
  roof.rotateX(-Math.PI / 2);

  k.solid
    .add(box(o.w + 0.3, 1.2, o.d + 0.3, STONE_DARK), { y: -0.45 })
    .add(box(o.w, o.h, o.d, o.wall), { y: o.h / 2 })
    .add(roof, { y: o.h + roofH / 3, sx: (o.w + 0.8) / 1.732, sy: roofH / 1.5 })
    .add(box(0.62, 1.05, 0.1, WOOD_DARK), { y: 0.52, z: o.d / 2 + 0.02 });
  if (o.chimney) {
    k.solid.add(box(0.36, 1.0, 0.36, '#7a6a62'), { x: o.w * 0.24, y: o.h + roofH * 0.6, z: -o.d * 0.18 });
  }

  const wy = o.h * 0.62;
  const ws = 0.46;
  for (const side of [-1, 1]) {
    k.window.add(box(ws, ws, 0.1, GLASS), { x: side * o.w * 0.3, y: wy, z: o.d / 2 + 0.02 });
    k.window.add(box(0.1, ws, ws, GLASS), { x: side * (o.w / 2 + 0.02), y: wy });
  }
  k.window.add(box(ws, ws, 0.1, GLASS), { y: wy, z: -o.d / 2 - 0.02 });
  stamp(into, k, t);
}

export function lampPost(into: Kit, t: Transform, height = 2.3): void {
  const k = newKit();
  k.solid
    .add(cyl(0.05, 0.08, height, 5, IRON), { y: height / 2 })
    .add(box(0.36, 0.06, 0.36, IRON), { y: height + 0.3 });
  k.lamp.add(box(0.24, 0.3, 0.24, GLASS), { y: height + 0.12 });
  stamp(into, k, t);
}

/** Striped lighthouse. Returns the lamp height in local units so a beam can be mounted there. */
export function lighthouse(into: Kit, t: Transform): number {
  const k = newKit();
  k.solid.add(cyl(2.1, 2.5, 1.2, 10, STONE_DARK), { y: 0.6 });

  const bands = 5;
  const bandH = 2.3;
  let y = 1.2;
  for (let i = 0; i < bands; i++) {
    const r0 = lerp(1.75, 1.12, i / bands);
    const r1 = lerp(1.75, 1.12, (i + 1) / bands);
    k.solid.add(cyl(r1, r0, bandH, 10, i % 2 ? '#d9483b' : '#f3eee2'), { y: y + bandH / 2 });
    y += bandH;
  }
  k.solid.add(cyl(1.75, 1.5, 0.26, 10, IRON), { y: y + 0.13 });
  y += 0.26;
  const lampHeight = y + 0.62;
  k.lamp.add(cyl(0.85, 0.85, 1.24, 8, GLASS), { y: lampHeight });
  y += 1.24;
  k.solid.add(cone(1.3, 1.25, 8, '#d9483b'), { y: y + 0.62 });

  k.solid.add(box(0.74, 1.3, 0.14, WOOD_DARK), { y: 1.85, z: 1.76 });
  k.window.add(box(0.36, 0.52, 0.12, GLASS), { y: 5.4, z: 1.58 });
  k.window.add(box(0.36, 0.52, 0.12, GLASS), { y: 9.4, z: 1.34 });
  stamp(into, k, t);
  return lampHeight;
}

/** Two opposed light cones. Additive, so it only reads when the scene is dark. */
export function lighthouseBeam(): { object: THREE.Group; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({
    color: '#fff0c2',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    fog: false,
  });
  const length = 54;
  const object = new THREE.Group();
  for (const side of [1, -1]) {
    const geometry = new THREE.ConeGeometry(4.2, length, 14, 6, true);
    geometry.translate(0, -length / 2, 0); // apex on the origin
    // Additive blending turns darker vertices into thinner light, so the beam fades out along its length.
    const points = geometry.getAttribute('position');
    const fade = new Float32Array(points.count * 3);
    for (let i = 0; i < points.count; i++) fade.fill(Math.pow(1 + points.getY(i) / length, 1.6), i * 3, i * 3 + 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(fade, 3));
    geometry.rotateZ((side * Math.PI) / 2);
    object.add(new THREE.Mesh(geometry, material));
  }
  object.rotation.z = 0.05;
  return { object, material };
}

/** Windmill body facing +z. Returns where the rotor hub sits, in local units. */
export function windmill(into: Kit, t: Transform): THREE.Vector3 {
  const k = newKit();
  k.solid
    .add(cyl(1.25, 1.5, 0.5, 8, STONE_DARK), { y: 0.1 })
    .add(cyl(0.85, 1.35, 5.6, 8, '#f1e8d6'), { y: 3.0 })
    .add(cone(1.2, 1.3, 8, '#b5533c'), { y: 6.45 })
    .add(box(0.7, 1.2, 0.12, WOOD_DARK), { y: 0.9, z: 1.3 })
    .add(cyl(0.12, 0.12, 0.9, 6, WOOD_DARK), { y: 5.3, z: 1.1, rx: Math.PI / 2 });
  k.window.add(box(0.4, 0.5, 0.12, GLASS), { y: 3.4, z: 1.12 });
  stamp(into, k, t);
  return new THREE.Vector3(0, 5.3, 1.6);
}

/** Four-sail rotor spinning around its local Z axis. */
export function windmillRotor(): THREE.Mesh {
  const parts = [ico(0.26, 0, WOOD_DARK)];
  for (let i = 0; i < 4; i++) {
    const rz = (i / 4) * TAU;
    const spar = xf(box(0.12, 3.5, 0.1, WOOD), { y: 1.85 });
    const sail = xf(box(0.78, 2.6, 0.05, '#f6eeda'), { x: 0.42, y: 2.15 });
    parts.push(xf(merge([spar, sail]), { rz }));
  }
  const mesh = new THREE.Mesh(merge(parts), solidMat);
  mesh.castShadow = true;
  return mesh;
}

/** Vermilion gateway, walkable along z. */
export function gate(into: Kit, t: Transform): void {
  const k = newKit();
  for (const side of [-1, 1]) {
    k.solid
      .add(cyl(0.34, 0.38, 0.4, 8, '#3a3640'), { x: side * 1.6, y: 0.2 })
      .add(cyl(0.2, 0.24, 4.0, 8, '#cf3f2e'), { x: side * 1.6, y: 2.2 });
  }
  k.solid
    .add(box(4.9, 0.3, 0.46, '#cf3f2e'), { y: 3.35 })
    .add(box(5.7, 0.34, 0.6, '#2a2933'), { y: 4.2 })
    .add(box(6.2, 0.14, 0.74, '#2a2933'), { y: 4.44 });
  stamp(into, k, t);
}

export function stoneLantern(into: Kit, t: Transform): void {
  const k = newKit();
  const stone = '#8a8794';
  k.solid
    .add(cyl(0.3, 0.36, 0.3, 6, stone), { y: 0.15 })
    .add(cyl(0.12, 0.14, 0.9, 6, stone), { y: 0.75 })
    .add(box(0.52, 0.1, 0.52, stone), { y: 1.25 })
    .add(cone(0.44, 0.36, 4, '#6f6c7a'), { y: 1.84, ry: Math.PI / 4 });
  k.lamp.add(box(0.32, 0.36, 0.32, GLASS), { y: 1.48 });
  stamp(into, k, t);
}

/** Giant mushroom with glowing spots. */
export function mushroom(into: Kit, t: Transform, cap: Paint): void {
  const k = newKit();
  k.solid
    .add(cyl(0.3, 0.46, 2.0, 7, '#efe4d0'), { y: 1.0 })
    .add(cyl(1.5, 1.36, 0.16, 9, '#f5ead8'), { y: 1.84 })
    .add(dome(1.5, 9, cap), { y: 1.9, sy: 0.72 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + i * 0.7;
    const e = 0.35 + (i % 3) * 0.3;
    k.spore.add(ico(0.15 + (i % 2) * 0.05, 0, GLASS), {
      x: Math.cos(a) * Math.cos(e) * 1.5,
      y: 1.9 + Math.sin(e) * 1.5 * 0.72,
      z: Math.sin(a) * Math.cos(e) * 1.5,
    });
  }
  stamp(into, k, t);
}

export function column(into: Kit, t: Transform, height: number, broken: boolean): void {
  const k = newKit();
  k.solid
    .add(box(1.3, 0.3, 1.3, STONE_DARK), { y: 0.15 })
    .add(cyl(0.42, 0.5, height, 8, STONE), { y: 0.3 + height / 2 });
  if (broken) k.solid.add(cyl(0.4, 0.42, 0.34, 8, STONE), { y: 0.36 + height, rz: 0.22 });
  else k.solid.add(box(1.16, 0.3, 1.16, STONE_DARK), { y: 0.45 + height });
  stamp(into, k, t);
}

export function arch(into: Kit, t: Transform, height = 4.2): void {
  const k = newKit();
  for (const side of [-1, 1]) {
    k.solid
      .add(box(1.2, 0.3, 1.2, STONE_DARK), { x: side * 1.9, y: 0.15 })
      .add(cyl(0.44, 0.5, height, 8, STONE), { x: side * 1.9, y: 0.3 + height / 2 });
  }
  k.solid
    .add(box(5.4, 0.55, 1.2, STONE), { y: height + 0.58 })
    .add(box(5.9, 0.22, 1.4, STONE_DARK), { y: height + 0.96 });
  stamp(into, k, t);
}

/** Pier with local +x pointing away from the island. */
export function dock(into: Kit, t: Transform): void {
  const k = newKit();
  k.solid.add(box(9.4, 0.22, 3.2, '#a17148'), { x: 3.0, y: 0.5 });
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      k.solid.add(cyl(0.14, 0.14, 3.0, 6, WOOD_DARK), { x: 0.4 + i * 2.3, y: -0.9, z: side * 1.42 });
    }
  }
  for (const side of [-1, 1]) {
    k.solid.add(box(6.6, 0.09, 0.09, WOOD_DARK), { x: 2.2, y: 1.3, z: side * 1.5 });
    for (let i = 0; i < 4; i++) k.solid.add(box(0.09, 0.8, 0.09, WOOD_DARK), { x: -1 + i * 2.1, y: 0.95, z: side * 1.5 });
    k.solid.add(cyl(0.16, 0.2, 0.55, 6, IRON), { x: 7.1, y: 0.86, z: side * 1.25 });
  }
  k.solid
    .add(box(0.8, 0.8, 0.8, '#b98a58'), { x: 5.4, y: 1.0, z: -0.95 })
    .add(box(0.6, 0.6, 0.6, '#a67a4c'), { x: 5.5, y: 0.9, z: -0.1, ry: 0.4 });
  stamp(into, k, t);
  lampPost(into, { ...t, ...offset(t, 7.2, 0.6, 1.3) });
}

/** Translate a point from a prop's local frame (Y rotation only) into its parent frame. */
function offset(t: Transform, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const ry = t.ry ?? 0;
  const s = t.s ?? 1;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  return {
    x: (t.x ?? 0) + (lx * cos + lz * sin) * s,
    y: (t.y ?? 0) + ly * s,
    z: (t.z ?? 0) + (-lx * sin + lz * cos) * s,
  };
}

export function fountain(into: Kit, t: Transform): void {
  const k = newKit();
  k.solid
    .add(cyl(1.7, 1.8, 0.55, 10, STONE), { y: 0.27 })
    .add(cyl(1.45, 1.45, 0.12, 10, '#6fc6dc'), { y: 0.52 })
    .add(cyl(0.2, 0.28, 1.3, 6, STONE_DARK), { y: 1.1 })
    .add(cyl(0.62, 0.3, 0.26, 8, STONE), { y: 1.8 });
  k.lamp.add(ico(0.2, 0, GLASS), { y: 2.12 });
  stamp(into, k, t);
}

/** Small hall with a stacked, dark-tiled roof, facing +z. */
export function shrine(into: Kit, t: Transform): void {
  const k = newKit();
  const roof = (w: number, d: number, h: number, y: number): THREE.BufferGeometry =>
    xf(cone(1, h, 4, '#2a2933'), { y, ry: Math.PI / 4, sx: w / 1.414, sz: d / 1.414 });
  k.solid
    .add(box(4.6, 0.5, 3.6, '#8a8794'), { y: 0.25 })
    .add(box(3.4, 1.9, 2.4, '#b8372b'), { y: 1.45 })
    .add(roof(5.2, 4.2, 1.1, 2.95))
    .add(box(2.2, 0.8, 1.5, '#b8372b'), { y: 3.5 })
    .add(roof(3.6, 2.9, 1.2, 4.5));
  for (const side of [-1, 1]) k.solid.add(cyl(0.14, 0.14, 1.9, 6, '#2a2933'), { x: side * 1.9, y: 1.45, z: 1.45 });
  k.window.add(box(1.1, 1.2, 0.12, GLASS), { y: 1.2, z: 1.2 });
  stamp(into, k, t);
}

/** Straight flight of steps climbing from one point to another. Returns how many steps it has. */
export function stairs(into: Kit, from: THREE.Vector3, to: THREE.Vector3, width: number, color: Paint): number {
  const run = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(2, Math.round((to.y - from.y) / 0.42));
  const depth = run / steps;
  const ry = Math.atan2(to.x - from.x, to.z - from.z);
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    const top = lerp(from.y, to.y, (i + 1) / steps);
    into.solid.add(box(width, 1.4, depth + 0.04, color), {
      x: lerp(from.x, to.x, f),
      y: top - 0.7,
      z: lerp(from.z, to.z, f),
      ry,
    });
  }
  return steps;
}

export function stoneBlock(into: Kit, t: Transform, w: number, h: number, d: number): void {
  into.solid.add(box(w, h, d, STONE), { ...t, y: (t.y ?? 0) + h / 2 - 0.08 });
}
