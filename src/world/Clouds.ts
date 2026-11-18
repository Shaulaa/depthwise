import * as THREE from 'three';
import type { DayNight } from '../core/DayNight';
import { TAU, mulberry32, range } from '../core/math';

interface Cluster {
  position: THREE.Vector3;
  speed: number;
}

interface Puff {
  cluster: number;
  offset: THREE.Vector3;
  scale: THREE.Vector3;
}

const WRAP = 640;

/** Drifting low-poly clouds: a sea of them below the islands and a few stragglers above. */
export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly clusters: Cluster[] = [];
  private readonly puffs: Puff[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();

  constructor() {
    const rng = mulberry32(77);

    const addCluster = (x: number, y: number, z: number, size: number, flat: number): void => {
      const index = this.clusters.length;
      this.clusters.push({ position: new THREE.Vector3(x, y, z), speed: range(rng, 0.5, 1.5) });
      const count = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const spread = i === 0 ? 0 : 1;
        const s = size * (i === 0 ? 1 : range(rng, 0.45, 0.8));
        this.puffs.push({
          cluster: index,
          offset: new THREE.Vector3(
            range(rng, -1.5, 1.5) * size * spread,
            range(rng, -0.12, 0.3) * size * spread,
            range(rng, -0.8, 0.8) * size * spread,
          ),
          scale: new THREE.Vector3(s * range(rng, 1.1, 1.6), s * flat, s * range(rng, 0.9, 1.3)),
        });
      }
    };

    // Cloud sea under the archipelago.
    for (let i = 0; i < 46; i++) {
      const angle = rng() * TAU;
      const radius = 60 + Math.sqrt(rng()) * 560;
      addCluster(Math.cos(angle) * radius, range(rng, -58, -30), Math.sin(angle) * radius, range(rng, 14, 30), 0.42);
    }
    // Stragglers at island height, kept away from the centre so they never block the view.
    for (let i = 0; i < 16; i++) {
      const angle = rng() * TAU;
      const radius = 190 + rng() * 380;
      addCluster(Math.cos(angle) * radius, range(rng, 20, 110), Math.sin(angle) * radius, range(rng, 9, 18), 0.5);
    }

    const geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.computeVertexNormals(); // non-indexed, so this yields faceted normals
    this.material = new THREE.MeshLambertMaterial({ color: '#eef2f8', emissive: '#ffffff', emissiveIntensity: 0.2 });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.puffs.length);
    this.mesh.frustumCulled = false;
    this.write();
  }

  update(dt: number, day: DayNight): void {
    for (const cluster of this.clusters) {
      cluster.position.x += cluster.speed * dt;
      if (cluster.position.x > WRAP) cluster.position.x -= WRAP * 2;
    }
    this.write();
    // A little self-illumination keeps cloud bellies from going black.
    this.material.emissive.copy(day.hemiSky).lerp(day.horizon, 0.35);
    this.material.emissiveIntensity = 0.24 * day.hemiIntensity;
  }

  private write(): void {
    this.puffs.forEach((puff, i) => {
      const cluster = this.clusters[puff.cluster] as Cluster;
      this.position.copy(cluster.position).add(puff.offset);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, puff.scale));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
