import * as THREE from 'three';
import { damp } from '../core/math';

const GOLD = new THREE.Color('#ffd27a');

/** Glowing ring with a floating gem: marks the spot on an island where its game begins. */
export class Beacon {
  readonly group = new THREE.Group();
  /** True while the character stands close enough to use it. */
  near = false;

  private readonly ring: THREE.Mesh;
  private readonly gem: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly gemMaterial: THREE.MeshBasicMaterial;
  private glow = 0;

  constructor(position: THREE.Vector3) {
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ringGeometry = new THREE.RingGeometry(0.95, 1.2, 40);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeometry, this.ringMaterial);
    this.ring.position.y = 0.06;

    this.gemMaterial = new THREE.MeshBasicMaterial({ color: GOLD });
    const gemGeometry = new THREE.OctahedronGeometry(0.26);
    gemGeometry.scale(1, 1.5, 1);
    this.gem = new THREE.Mesh(gemGeometry, this.gemMaterial);

    this.group.add(this.ring, this.gem);
    this.group.position.copy(position);
  }

  update(dt: number, time: number, night: number): void {
    this.glow = damp(this.glow, this.near ? 1 : 0, 6, dt);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
    // Values above 1 feed the bloom pass; nights get a little extra so it reads from afar.
    const strength = 1.1 + night * 0.8 + this.glow * 1.6;
    this.ringMaterial.color.copy(GOLD).multiplyScalar(strength * (0.7 + 0.3 * pulse));
    this.ringMaterial.opacity = 0.55 + 0.35 * pulse + this.glow * 0.1;
    this.ring.scale.setScalar(1 + this.glow * 0.25 + pulse * 0.05);
    this.gemMaterial.color.copy(GOLD).multiplyScalar(strength);
    this.gem.position.y = 2.1 + Math.sin(time * 1.8) * 0.16 + this.glow * 0.35;
    this.gem.rotation.y = time * 1.4;
  }
}
