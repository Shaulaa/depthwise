import * as THREE from 'three';
import gsap from 'gsap';
import { clamp, damp } from '../core/math';
import { Batch, box, cone, cyl, dome, ico } from './geo';
import { solidMat } from './materials';

const BOOT = '#5e3f2c';
const BRASS = '#d9a441';
const LENS = '#9fe0f0';
/** Painted on parts whose colour comes from a material instead, so the material tint shows unchanged. */
const TINTABLE = '#ffffff';

export type Headwear = 'goggles' | 'cap' | 'bun' | 'hood' | 'straw';

/** Everything that makes one figure look different from another. */
export interface Look {
  skin: string;
  hair: string;
  pants: string;
  headwear: Headwear;
  /** Colour of the hat, cap or hood, where there is one. */
  hat?: string;
}

/** The two colours a costume changes; they can be swapped at any time. */
export interface Outfit {
  jacket: string;
  scarf: string;
}

export const PILOT: Look = { skin: '#f1c7a0', hair: '#3b2a26', pants: '#27325a', headwear: 'goggles' };
export const PILOT_OUTFIT: Outfit = { jacket: '#f4ead2', scarf: '#e0583d' };

function part(build: (batch: Batch) => void, material: THREE.Material = solidMat): THREE.Mesh {
  const batch = new Batch();
  build(batch);
  const mesh = batch.mesh(material);
  mesh.receiveShadow = false;
  return mesh;
}

/** Pivot group with a mesh hanging off it, for limbs that swing from a joint. */
function limb(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(mesh);
  return pivot;
}

/** Hair and whatever sits on it. Built in head space, with the face looking along +z. */
function headwear(b: Batch, look: Look): void {
  const hat = look.hat ?? '#3f6aa8';
  b.add(dome(0.385, 12, look.hair), { y: 0.33, rx: -0.32, sy: 0.95 });
  switch (look.headwear) {
    case 'goggles':
      b.add(box(0.5, 0.16, 0.18, look.hair), { y: 0.53, z: 0.2, rx: 0.5 }); // fringe
      for (const side of [-1, 1]) {
        b.add(cyl(0.085, 0.085, 0.07, 10, BRASS), { x: side * 0.12, y: 0.58, z: 0.27, rx: 1.1 });
        b.add(cyl(0.06, 0.06, 0.075, 10, LENS), { x: side * 0.12, y: 0.585, z: 0.275, rx: 1.1 });
      }
      b.add(box(0.5, 0.05, 0.1, BOOT), { y: 0.56, z: 0.18, rx: 1.1 }); // strap
      break;
    case 'cap':
      b.add(dome(0.4, 12, hat), { y: 0.42, sy: 0.7 });
      b.add(box(0.42, 0.04, 0.26, hat), { y: 0.44, z: 0.36 }); // peak
      b.add(box(0.12, 0.08, 0.02, BRASS), { y: 0.56, z: 0.38 }); // badge
      break;
    case 'bun':
      b.add(box(0.5, 0.14, 0.16, look.hair), { y: 0.55, z: 0.22, rx: 0.45 });
      b.add(ico(0.17, 1, look.hair, true), { y: 0.72, z: -0.12 });
      b.add(cyl(0.03, 0.03, 0.4, 5, hat), { y: 0.74, z: -0.12, rz: 1.2 }); // hairpin
      break;
    case 'hood':
      b.add(dome(0.43, 12, hat), { y: 0.3, rx: -0.5, sy: 1.05 });
      b.add(cone(0.12, 0.35, 6, hat), { y: 0.74, z: -0.2, rx: -0.6 });
      break;
    case 'straw':
      b.add(box(0.5, 0.14, 0.16, look.hair), { y: 0.53, z: 0.22, rx: 0.5 });
      b.add(cyl(0.62, 0.62, 0.04, 14, hat), { y: 0.56 }); // brim
      b.add(cone(0.36, 0.28, 12, hat), { y: 0.72 });
      break;
  }
}

/**
 * A chibi figure: the player's sky sailor, or one of the islanders. Origin at the feet, facing +Z.
 * It only draws itself; where it is and how fast it moves come from a Walker.
 */
export class Character {
  readonly root = new THREE.Group();
  /** Point the camera orbits while on foot: about chest height. */
  readonly anchor = new THREE.Object3D();

  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly legs: THREE.Group[];
  private readonly arms: THREE.Group[];
  private readonly scarf: THREE.Group;
  // Each figure owns these two, so one costume change never recolours anybody else.
  private readonly jacketMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly scarfMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private phase = Math.random() * 10;
  private stride = 0;
  private squash = 0;
  private hop: gsap.core.Timeline | null = null;
  /** Overall size, 1 normally; only the vanish animation changes it. */
  private readonly shrink = { value: 1 };

  constructor(look: Look = PILOT, outfit: Outfit = PILOT_OUTFIT) {
    const legMesh = (): THREE.Mesh =>
      part((b) => {
        b.add(cyl(0.11, 0.1, 0.3, 7, look.pants), { y: -0.15 });
        b.add(box(0.2, 0.13, 0.28, BOOT), { y: -0.33, z: 0.04 });
      });
    this.legs = [-1, 1].map((side) => limb(legMesh(), side * 0.13, 0.4, 0));

    const jacket = part((b) => b.add(cyl(0.25, 0.3, 0.42, 9, TINTABLE, true), { y: 0.6 }), this.jacketMaterial);
    const belt = part((b) => {
      b.add(cyl(0.31, 0.31, 0.07, 9, BOOT), { y: 0.43 });
      b.add(box(0.08, 0.06, 0.03, BRASS), { y: 0.43, z: 0.3 });
    });
    const wrap = part((b) => b.add(cyl(0.27, 0.27, 0.13, 10, TINTABLE, true), { y: 0.8 }), this.scarfMaterial);

    const armMesh = (): THREE.Group => {
      const group = new THREE.Group();
      group.add(
        part((b) => b.add(cyl(0.08, 0.075, 0.3, 6, TINTABLE), { y: -0.15 }), this.jacketMaterial),
        part((b) => b.add(ico(0.085, 1, look.skin, true), { y: -0.33 })),
      );
      return group;
    };
    this.arms = [-1, 1].map((side) => {
      const pivot = armMesh();
      pivot.position.set(side * 0.32, 0.76, 0);
      return pivot;
    });

    // A big round head is most of what makes a figure read as chibi.
    const headMesh = part((b) => {
      b.add(ico(0.36, 2, look.skin, true), { y: 0.3 });
      headwear(b, look);
      for (const side of [-1, 1]) {
        b.add(box(0.07, 0.11, 0.03, '#1e1a24'), { x: side * 0.13, y: 0.28, z: 0.345 }); // eyes
        b.add(cyl(0.05, 0.05, 0.02, 8, '#f39a8f'), { x: side * 0.22, y: 0.2, z: 0.3, rx: Math.PI / 2 }); // cheeks
      }
    });
    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    this.head.add(headMesh);

    // Loose scarf end that streams out behind when running.
    const tail = part((b) => b.add(box(0.13, 0.36, 0.04, TINTABLE), { y: -0.18 }), this.scarfMaterial);
    this.scarf = limb(tail, 0.1, 0.84, -0.24);

    this.body.add(jacket, belt, wrap, this.head, this.scarf, ...this.arms, ...this.legs);
    this.root.add(this.body);
    this.root.visible = false;
    this.wear(outfit);
  }

  /** Change the jacket and scarf colours. */
  wear(outfit: Outfit): void {
    this.jacketMaterial.color.set(outfit.jacket);
    this.scarfMaterial.color.set(outfit.scarf);
  }

  /**
   * Pose the figure for this frame.
   * @param speed Horizontal speed in units per second.
   * @param airborne True while jumping or falling.
   */
  update(dt: number, time: number, speed: number, airborne: boolean): void {
    const pace = clamp(speed / 8.2, 0, 1);
    this.stride = damp(this.stride, airborne ? 0.25 : clamp(speed / 4.6, 0, 1), 10, dt);
    this.phase += dt * (4 + speed * 1.55);
    this.squash = damp(this.squash, 0, 9, dt);

    const swing = Math.sin(this.phase) * this.stride;
    const [leftLeg, rightLeg] = this.legs as [THREE.Group, THREE.Group];
    const [leftArm, rightArm] = this.arms as [THREE.Group, THREE.Group];
    leftLeg.rotation.x = swing * 0.8;
    rightLeg.rotation.x = -swing * 0.8;
    leftArm.rotation.x = -swing * 0.9;
    rightArm.rotation.x = swing * 0.9;
    // Arms fling up in the air, hang loose at rest.
    const flail = airborne ? 0.9 : 0.12 + pace * 0.1;
    leftArm.rotation.z = damp(leftArm.rotation.z, -flail, 10, dt);
    rightArm.rotation.z = damp(rightArm.rotation.z, flail, 10, dt);

    const breath = Math.sin(time * 2.2) * 0.012 * (1 - this.stride);
    const bob = Math.abs(Math.sin(this.phase)) * 0.07 * this.stride;
    this.body.position.y = bob + breath;
    this.body.rotation.x = damp(this.body.rotation.x, pace * 0.22, 8, dt);
    this.head.rotation.x = -this.body.rotation.x * 0.6 + Math.sin(this.phase * 2) * 0.03 * this.stride;
    this.head.rotation.z = Math.sin(time * 0.9) * 0.04 * (1 - this.stride);
    this.scarf.rotation.x = damp(this.scarf.rotation.x, -0.15 - pace * 1.1 + Math.sin(time * 9) * 0.12 * pace, 8, dt);

    const s = this.squash;
    const k = this.shrink.value;
    this.body.scale.set((1 + s * 0.18) * k, (1 - s * 0.22) * k, (1 + s * 0.18) * k);

    this.anchor.position.copy(this.root.position);
    this.anchor.position.y += 1.15;
  }

  /** A quick squash on landing; negative values stretch instead. */
  impact(amount: number): void {
    this.squash = amount;
  }

  /** Place and turn the figure. */
  place(position: THREE.Vector3, yaw: number): void {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    this.anchor.position.copy(position);
    this.anchor.position.y += 1.15;
  }

  /** Leap in an arc from one point to another, for getting on and off the ship. */
  leap(from: THREE.Vector3, to: THREE.Vector3, height = 1.6, duration = 0.6): Promise<void> {
    this.hop?.kill();
    const state = { t: 0 };
    const point = new THREE.Vector3();
    this.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    this.squash = -0.6;
    return new Promise((resolve) => {
      this.hop = gsap.timeline({ onComplete: () => resolve(), onInterrupt: () => resolve() }).to(state, {
        t: 1,
        duration,
        ease: 'none',
        onUpdate: () => {
          point.lerpVectors(from, to, state.t);
          point.y += Math.sin(state.t * Math.PI) * height;
          this.root.position.copy(point);
          this.anchor.position.copy(point);
          this.anchor.position.y += 1.15;
        },
      });
    });
  }

  /** Spin on the spot, hop up a little and shrink to nothing: a quick exit when the ship is too far to jump to. */
  vanish(duration = 0.45): Promise<void> {
    this.hop?.kill();
    const root = this.root;
    const startY = root.position.y;
    this.squash = -0.5;
    return new Promise((resolve) => {
      this.hop = gsap
        .timeline({ onComplete: () => resolve(), onInterrupt: () => resolve() })
        .to(root.rotation, { y: root.rotation.y + Math.PI * 3, duration, ease: 'power2.in' }, 0)
        .to(root.position, { y: startY + 0.9, duration, ease: 'power1.out' }, 0)
        .to(this.shrink, { value: 0, duration, ease: 'back.in(2)' }, 0);
    });
  }

  get busy(): boolean {
    return this.hop?.isActive() ?? false;
  }

  set visible(value: boolean) {
    this.root.visible = value;
    if (value) this.shrink.value = 1; // undo a previous vanish
  }

  get visible(): boolean {
    return this.root.visible;
  }
}
