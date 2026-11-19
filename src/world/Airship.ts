import * as THREE from 'three';
import gsap from 'gsap';
import { TAU, clamp, damp } from '../core/math';
import { Batch, box, cone, cyl, ico, merge, paint, paintFaces, xf } from './geo';
import { lampGlow, windowGlow } from './materials';

const CREAM = '#f4ead2';
const VERMILION = '#e0583d';
const NAVY = '#27325a';
const WOOD = '#8a5d3f';
const WOOD_DARK = '#5e3f2c';

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const look = new THREE.Matrix4();
const tangent = new THREE.Vector3();
const forward = new THREE.Vector3();
const wanted = new THREE.Vector3();

/** How far below the ship's origin the keel sits; used to rest it beside a dock. */
export const KEEL_DEPTH = 4.45;

/** The player's airship. Local +Z is the bow. */
export class Airship {
  readonly root = new THREE.Group();
  /** Smoothed speed in world units per second. */
  speed = 0;
  /** Extra roll requested by gameplay, in radians. */
  bank = 0;

  private readonly body = new THREE.Group();
  private readonly propeller: THREE.Mesh;
  private readonly light: THREE.PointLight;
  /** The ship's own copy of the solid material, so it can turn see-through without the world following. */
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly glows: THREE.Mesh[];
  private opacity = 1;
  private readonly heading = new THREE.Quaternion();
  private readonly lastPosition = new THREE.Vector3();
  private roll = 0;
  private flight: gsap.core.Tween | null = null;

  constructor() {
    const solid = new Batch();
    const glass = new Batch();
    const lamp = new Batch();

    // Envelope: an ellipsoid with painted gores and dark caps.
    const sphere = new THREE.SphereGeometry(1, 24, 14);
    sphere.rotateX(Math.PI / 2);
    sphere.scale(2.35, 2.15, 5.4);
    const envelope = sphere.toNonIndexed();
    envelope.deleteAttribute('uv');
    paint(envelope, CREAM);
    paintFaces(envelope, (c) => {
      // Classify by latitude band so both triangles of a quad agree and the caps get a clean edge.
      const band = Math.floor((Math.acos(clamp(c.z / 5.4, -1, 1)) / Math.PI) * 14);
      if (band < 2 || band > 11) return NAVY;
      const gore = Math.floor(((Math.atan2(c.y, c.x) + Math.PI) / TAU) * 12);
      return gore % 2 === 0 ? CREAM : VERMILION;
    });
    solid.add(envelope);

    // Four swept-back tail fins in an X.
    for (let i = 0; i < 4; i++) {
      const fin = box(0.12, 1.5, 1.7, NAVY);
      const corners = fin.getAttribute('position');
      for (let v = 0; v < corners.count; v++) {
        const height = corners.getY(v) + 0.75;
        const taper = 1 - height * 0.3;
        corners.setZ(v, corners.getZ(v) * taper - height * 0.7);
      }
      fin.computeVertexNormals();
      solid.add(xf(fin, { y: 1.45, z: -3.75 }), { rz: Math.PI / 4 + (i * Math.PI) / 2 });
    }

    // Gondola.
    const bow = cone(1, 1.5, 4, WOOD);
    bow.rotateY(Math.PI / 4);
    bow.rotateX(Math.PI / 2);
    solid
      .add(box(1.7, 0.9, 4.0, WOOD), { y: -3.75 })
      .add(box(1.2, 0.26, 3.4, WOOD_DARK), { y: -4.32 })
      .add(bow, { sx: 1.2, sy: 0.64, y: -3.75, z: 2.74 })
      .add(box(1.84, 0.1, 4.1, WOOD_DARK), { y: -3.28 })
      .add(box(1.3, 0.95, 1.6, CREAM), { y: -2.78, z: -0.7 })
      .add(box(1.56, 0.12, 1.86, VERMILION), { y: -2.26, z: -0.7 })
      .add(box(0.07, 0.5, 0.07, WOOD_DARK), { y: -3.02, z: 1.85 });
    for (const x of [-0.8, 0.8]) {
      for (const z of [1.6, -1.7]) solid.add(cyl(0.03, 0.03, 1.25, 4, WOOD_DARK), { x, y: -2.7, z });
    }

    for (const side of [-1, 1]) glass.add(box(0.08, 0.42, 0.9, CREAM), { x: side * 0.65, y: -2.74, z: -0.7 });
    glass.add(box(0.8, 0.42, 0.08, CREAM), { y: -2.74, z: 0.1 });
    lamp.add(ico(0.2, 0, CREAM), { y: -2.72, z: 1.85 });

    const blades = [cyl(0.14, 0.14, 0.3, 6, WOOD_DARK).rotateX(Math.PI / 2)];
    for (let i = 0; i < 3; i++) blades.push(xf(xf(box(0.18, 1.1, 0.05, CREAM), { y: 0.6 }), { rz: (i / 3) * TAU }));
    this.propeller = new THREE.Mesh(merge(blades), this.material);
    this.propeller.position.set(0, -3.75, -2.2);

    this.light = new THREE.PointLight('#ffcf8a', 0, 30, 1.6);
    this.light.position.set(0, -2.7, 1.9);

    const hull = solid.mesh(this.material);
    hull.receiveShadow = false;
    this.glows = [new THREE.Mesh(glass.geometry(), windowGlow), new THREE.Mesh(lamp.geometry(), lampGlow)];
    this.body.add(hull, ...this.glows, this.propeller, this.light);
    this.root.add(this.body);
  }

  /**
   * Fade the ship towards an opacity, used when it stands between the camera and the character.
   * Call every frame; it eases on its own.
   */
  fadeTo(target: number, dt: number): void {
    this.opacity = damp(this.opacity, target, 8, dt);
    if (this.opacity > 0.995) this.opacity = 1;
    const solid = this.opacity === 1;
    if (this.material.transparent === solid) {
      // Three.js bakes opaque output into the shader, so flipping transparency needs a recompile.
      this.material.transparent = !solid;
      this.material.depthWrite = solid;
      this.material.needsUpdate = true;
    }
    this.material.opacity = this.opacity;
    for (const mesh of this.glows) mesh.visible = this.opacity > 0.6;
  }

  /** Park the ship instantly. Yaw 0 points the bow along +Z. */
  moor(position: THREE.Vector3, yaw: number): void {
    this.flight?.kill();
    this.root.position.copy(position);
    this.lastPosition.copy(position);
    this.heading.setFromAxisAngle(UP, yaw);
    this.root.quaternion.copy(this.heading);
    this.speed = 0;
  }

  /** Turn towards a yaw; the ship eases round on its own. */
  turnTo(yaw: number): void {
    this.heading.setFromAxisAngle(UP, yaw);
  }

  /** Point the bow along a direction; the ship eases round on its own. */
  face(direction: THREE.Vector3): void {
    // Airships stay close to level: keep only a hint of the climb or descent.
    wanted.copy(direction);
    wanted.y *= 0.3;
    look.lookAt(wanted.normalize(), ORIGIN, UP);
    this.heading.setFromRotationMatrix(look);
  }

  /** Follow a curve from end to end. Resolves on arrival. */
  flyAlong(curve: THREE.Curve<THREE.Vector3>, duration: number): Promise<void> {
    this.flight?.kill();
    const state = { u: 0 };
    return new Promise((resolve) => {
      this.flight = gsap.to(state, {
        u: 1,
        duration,
        ease: 'sine.inOut',
        onUpdate: () => {
          curve.getPointAt(state.u, this.root.position);
          this.face(curve.getTangentAt(state.u, tangent));
        },
        onComplete: () => resolve(),
      });
    });
  }

  /** Ease straight back to a mooring, for short hops that do not need a flight path. */
  glideTo(position: THREE.Vector3, yaw: number, duration = 1.8): void {
    this.flight?.kill();
    this.turnTo(yaw);
    this.flight = gsap.to(this.root.position, {
      x: position.x,
      y: position.y,
      z: position.z,
      duration,
      ease: 'power2.inOut',
    });
  }

  /** Stop any scripted movement so gameplay can steer the ship directly. */
  release(): void {
    this.flight?.kill();
    this.flight = null;
  }

  update(dt: number, time: number, night: number): void {
    const moved = this.root.position.distanceTo(this.lastPosition);
    this.lastPosition.copy(this.root.position);
    this.speed = damp(this.speed, moved / Math.max(dt, 1e-4), 5, dt);

    // Bank into turns: the further the bow has to swing, the harder the roll.
    forward.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    wanted.set(0, 0, 1).applyQuaternion(this.heading);
    const turn = forward.z * wanted.x - forward.x * wanted.z;
    this.roll = damp(this.roll, clamp(-turn * 1.8 + this.bank, -0.3, 0.3), 3.5, dt);
    this.root.quaternion.slerp(this.heading, 1 - Math.exp(-4.5 * dt));

    this.body.position.y = Math.sin(time * 1.1) * 0.22;
    this.body.rotation.set(Math.sin(time * 0.8) * 0.018, 0, this.roll + Math.sin(time * 0.9 + 1) * 0.02);
    this.propeller.rotation.z += dt * (5 + this.speed * 1.5);
    this.light.intensity = night * 48;
  }
}
