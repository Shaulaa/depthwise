import * as THREE from 'three';

const POOL = 48;
const LIFE = 0.65;

interface Puff {
  age: number;
  size: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();

/** Little puffs of dust kicked up by feet: one draw call for every puff alive. */
export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private next = 0;

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshLambertMaterial({ color: '#efe4cc', transparent: true, opacity: 0.8, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) {
      this.puffs.push({ age: LIFE, size: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3() });
      this.mesh.setMatrixAt(i, matrix.makeScale(0, 0, 0));
    }
  }

  /** Throw `count` puffs out around a point on the ground. */
  burst(at: THREE.Vector3, count: number, strength = 1): void {
    for (let i = 0; i < count; i++) {
      const puff = this.puffs[this.next] as Puff;
      this.next = (this.next + 1) % POOL;
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.6 + Math.random() * 0.9) * strength;
      puff.age = 0;
      puff.size = (0.1 + Math.random() * 0.08) * (0.8 + strength * 0.3);
      puff.position.set(at.x + Math.cos(angle) * 0.2, at.y + 0.08, at.z + Math.sin(angle) * 0.2);
      puff.velocity.set(Math.cos(angle) * speed, 0.5 + Math.random() * 0.6, Math.sin(angle) * speed);
    }
  }

  update(dt: number): void {
    let alive = false;
    this.puffs.forEach((puff, i) => {
      if (puff.age >= LIFE) return;
      alive = true;
      puff.age += dt;
      puff.velocity.multiplyScalar(Math.exp(-4 * dt));
      puff.position.addScaledVector(puff.velocity, dt);
      // Swell, then shrink away to nothing.
      const t = Math.min(1, puff.age / LIFE);
      scale.setScalar(puff.size * (1 + t * 1.6) * (1 - t * t));
      this.mesh.setMatrixAt(i, matrix.compose(puff.position, quaternion, scale));
    });
    if (alive) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
