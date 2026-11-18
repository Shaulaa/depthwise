import * as THREE from 'three';
import { mulberry32, pick, range, type Rng } from '../core/math';
import { cone, cyl, ico, merge, xf } from './geo';
import { foliageMat, grassMat, solidMat } from './materials';

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const tint = new THREE.Color();

export interface Instance {
  p: THREE.Vector3;
  ry?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color?: THREE.ColorRepresentation;
}

export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly Instance[],
  shadows = true,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((item, i) => {
    quat.setFromEuler(euler.set(0, item.ry ?? 0, 0));
    scale.set(item.sx ?? 1, item.sy ?? item.sx ?? 1, item.sz ?? item.sx ?? 1);
    mesh.setMatrixAt(i, matrix.compose(item.p, quat, scale));
    if (item.color !== undefined) mesh.setColorAt(i, tint.set(item.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

// Crowns are white so the per-instance colour fully controls the leaf tone.
const TRUNK = '#8a6248';

function roundTree(): THREE.BufferGeometry {
  return merge([
    xf(cyl(0.16, 0.26, 1.7, 6, TRUNK), { y: 0.85 }),
    xf(ico(1.25, 1, '#ffffff'), { y: 2.55, sy: 0.92 }),
    xf(ico(0.86, 1, '#f1f1f1'), { x: 0.72, y: 2.0, z: 0.28 }),
    xf(ico(0.78, 1, '#e6e6e6'), { x: -0.58, y: 2.1, z: -0.44 }),
  ]);
}

function pineTree(): THREE.BufferGeometry {
  return merge([
    xf(cyl(0.13, 0.2, 1.2, 6, TRUNK), { y: 0.6 }),
    xf(cone(1.2, 1.7, 7, '#e9e9e9'), { y: 1.75 }),
    xf(cone(0.92, 1.5, 7, '#f4f4f4'), { y: 2.75, ry: 0.4 }),
    xf(cone(0.6, 1.25, 7, '#ffffff'), { y: 3.65, ry: 0.8 }),
  ]);
}

function grassTuft(): THREE.BufferGeometry {
  const rng = mulberry32(11);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  for (let blade = 0; blade < 4; blade++) {
    const angle = (blade / 4) * Math.PI + rng() * 0.5;
    const cx = Math.cos(angle) * 0.085;
    const cz = Math.sin(angle) * 0.085;
    const ox = (rng() - 0.5) * 0.3;
    const oz = (rng() - 0.5) * 0.3;
    const height = 0.45 + rng() * 0.35;
    const lean = (rng() - 0.5) * 0.3;
    positions.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, ox + lean, height, oz + lean * 0.5);
    colors.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1.08, 1.08, 1.08);
    // Up-facing normals light the blades like the ground they grow from.
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function flower(): THREE.BufferGeometry {
  const head = xf(ico(0.11, 0, '#ffffff'), { y: 0.34 });
  const stem = xf(cone(0.035, 0.34, 3, '#5c8a4a'), { y: 0.17 });
  const geometry = merge([stem, head]);
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  return geometry;
}

let geometries: {
  round: THREE.BufferGeometry;
  pine: THREE.BufferGeometry;
  grass: THREE.BufferGeometry;
  flower: THREE.BufferGeometry;
  rock: THREE.BufferGeometry;
} | null = null;

function lib(): NonNullable<typeof geometries> {
  geometries ??= {
    round: roundTree(),
    pine: pineTree(),
    grass: grassTuft(),
    flower: flower(),
    rock: ico(1, 0, '#ffffff'),
  };
  return geometries;
}

export type TreeKind = 'round' | 'pine';

export function trees(
  kind: TreeKind,
  points: readonly THREE.Vector3[],
  rng: Rng,
  colors: readonly string[],
  size: [number, number] = [0.85, 1.45],
): THREE.InstancedMesh {
  const items = points.map<Instance>((p) => {
    const s = range(rng, size[0], size[1]);
    return {
      p: new THREE.Vector3(p.x, p.y - 0.12, p.z),
      ry: rng() * Math.PI * 2,
      sx: s,
      sy: s * range(rng, 0.9, 1.18),
      sz: s,
      color: pick(rng, colors),
    };
  });
  return instanced(lib()[kind], foliageMat, items);
}

export function grass(points: readonly THREE.Vector3[], rng: Rng, colors: readonly string[]): THREE.InstancedMesh {
  const items = points.map<Instance>((p) => ({
    p,
    ry: rng() * Math.PI * 2,
    sx: range(rng, 0.9, 1.7),
    sy: range(rng, 0.8, 1.6),
    color: pick(rng, colors),
  }));
  const mesh = instanced(lib().grass, grassMat, items, false);
  mesh.receiveShadow = true;
  return mesh;
}

export function flowers(points: readonly THREE.Vector3[], rng: Rng, colors: readonly string[]): THREE.InstancedMesh {
  const items = points.map<Instance>((p) => ({
    p,
    ry: rng() * Math.PI * 2,
    sx: range(rng, 0.8, 1.4),
    color: pick(rng, colors),
  }));
  return instanced(lib().flower, grassMat, items, false);
}

export function rocks(points: readonly THREE.Vector3[], rng: Rng, colors: readonly string[], size: [number, number] = [0.3, 1.0]): THREE.InstancedMesh {
  const items = points.map<Instance>((p) => {
    const s = range(rng, size[0], size[1]);
    return {
      p: new THREE.Vector3(p.x, p.y + s * 0.15, p.z),
      ry: rng() * Math.PI * 2,
      sx: s * range(rng, 0.8, 1.4),
      sy: s * range(rng, 0.55, 0.95),
      sz: s * range(rng, 0.8, 1.3),
      color: pick(rng, colors),
    };
  });
  return instanced(lib().rock, solidMat, items);
}
