import * as THREE from 'three';
import gsap from 'gsap';

interface Feather {
  id: string;
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  taken: boolean;
}

/** How close the character's chest must come to a feather to pick it up. */
const REACH = 1.15;
/** Height of the character's chest above its feet. */
const CHEST = 0.7;

/** Every wind feather in the archipelago: drifting, glowing, and gone once picked up. */
export class Feathers {
  readonly group = new THREE.Group();
  private readonly items: Feather[] = [];
  private readonly material = new THREE.MeshBasicMaterial({ color: '#d8f6ff', side: THREE.DoubleSide });

  constructor(spots: Iterable<{ island: string; points: readonly THREE.Vector3[] }>) {
    // A quill: thin vane with a darker shaft, built once and shared by every feather.
    const vane = new THREE.SphereGeometry(0.5, 10, 6);
    vane.scale(0.17, 0.62, 0.035);
    for (const { island, points } of spots) {
      points.forEach((home, i) => {
        const mesh = new THREE.Mesh(vane, this.material);
        mesh.position.copy(home);
        mesh.rotation.z = 0.5;
        this.group.add(mesh);
        this.items.push({ id: `${island}-${i}`, mesh, home: home.clone(), taken: false });
      });
    }
  }

  get total(): number {
    return this.items.length;
  }

  /** Hide the feathers picked up in an earlier visit. */
  restore(taken: readonly string[]): void {
    for (const item of this.items) {
      item.taken = taken.includes(item.id);
      item.mesh.visible = !item.taken;
      item.mesh.scale.setScalar(1);
      item.mesh.position.copy(item.home);
    }
  }

  update(time: number, night: number): void {
    // Bright enough by day to catch the eye, and over 1 at night so the bloom gives it a halo.
    this.material.color.set('#d8f6ff').multiplyScalar(1.15 + night * 0.9 + Math.sin(time * 3) * 0.12);
    this.items.forEach((item, i) => {
      if (item.taken) return;
      item.mesh.position.y = item.home.y + Math.sin(time * 1.6 + i) * 0.14;
      item.mesh.rotation.y = time * 1.3 + i;
    });
  }

  /** Pick up whatever feather the character at `feet` touches. Returns its id, or null. */
  collect(feet: THREE.Vector3): string | null {
    for (const item of this.items) {
      if (item.taken) continue;
      const dx = item.mesh.position.x - feet.x;
      const dy = item.mesh.position.y - (feet.y + CHEST);
      const dz = item.mesh.position.z - feet.z;
      if (dx * dx + dy * dy + dz * dz > REACH * REACH) continue;
      item.taken = true;
      // Whirl up and away rather than blinking out.
      const mesh = item.mesh;
      gsap
        .timeline({ onComplete: () => void (mesh.visible = false) })
        .to(mesh.position, { y: mesh.position.y + 2.2, duration: 0.7, ease: 'power2.out' }, 0)
        .to(mesh.rotation, { y: mesh.rotation.y + Math.PI * 4, duration: 0.7, ease: 'power1.in' }, 0)
        .to(mesh.scale, { x: 0, y: 0, z: 0, duration: 0.7, ease: 'back.in(2)' }, 0);
      return item.id;
    }
    return null;
  }
}
