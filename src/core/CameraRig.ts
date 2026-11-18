import * as THREE from 'three';
import gsap from 'gsap';
import { clamp, damp, shortestAngle } from './math';

export interface RigLimits {
  minPhi: number;
  maxPhi: number;
  minRadius: number;
  maxRadius: number;
}

export interface RigView {
  target?: THREE.Vector3;
  theta?: number;
  phi?: number;
  radius?: number;
}

/**
 * Orbit camera driven by a goal state. User input and scripted flights both write to the goal;
 * the camera eases towards it every frame, which keeps hand-offs between the two seamless.
 */
export class CameraRig {
  /** Accept drag/zoom input. */
  enabled = true;
  /** Write to the camera. Mini games that drive the camera themselves switch this off. */
  active = true;
  /** Idle rotation in radians per second. */
  autoRotate = 0;
  /** Keep the orbit centre glued to a moving object. */
  follow: THREE.Object3D | null = null;

  readonly target = new THREE.Vector3();
  readonly goal = { x: 0, y: 0, z: 0, theta: 0, phi: 1, radius: 100 };
  limits: RigLimits = { minPhi: 0.2, maxPhi: 1.5, minRadius: 20, maxRadius: 400 };

  private theta = 0;
  private phi = 1;
  private radius = 100;
  private idle = 0;
  private flight: gsap.core.Tween | null = null;
  private readonly offset = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  drag(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.idle = 0;
    this.goal.theta -= dx * 0.0052;
    this.goal.phi = clamp(this.goal.phi - dy * 0.0052, this.limits.minPhi, this.limits.maxPhi);
  }

  zoom(delta: number): void {
    if (!this.enabled) return;
    this.idle = 0;
    this.goal.radius = clamp(this.goal.radius * Math.exp(delta * 0.0011), this.limits.minRadius, this.limits.maxRadius);
  }

  /** Jump straight to a view without easing. */
  snap(view: RigView): void {
    this.flight?.kill();
    this.applyView(view);
    this.theta = this.goal.theta;
    this.phi = this.goal.phi;
    this.radius = this.goal.radius;
    this.target.set(this.goal.x, this.goal.y, this.goal.z);
  }

  /** Ease to a view. Input is held back until the flight lands. */
  flyTo(view: RigView, duration = 1.8, limits?: RigLimits): Promise<void> {
    this.flight?.kill();
    if (limits) this.limits = limits;
    const to: gsap.TweenVars = { duration, ease: 'power3.inOut' };
    if (view.target) Object.assign(to, { x: view.target.x, y: view.target.y, z: view.target.z });
    if (view.theta !== undefined) to.theta = this.goal.theta + shortestAngle(this.goal.theta, view.theta);
    if (view.phi !== undefined) to.phi = view.phi;
    if (view.radius !== undefined) to.radius = view.radius;

    const wasEnabled = this.enabled;
    this.enabled = false;
    return new Promise((resolve) => {
      const finish = (): void => {
        this.enabled = wasEnabled;
        this.clampGoal();
        resolve();
      };
      this.flight = gsap.to(this.goal, { ...to, onComplete: finish, onInterrupt: finish });
    });
  }

  /** Re-derive the orbit from wherever the camera currently is, for a smooth hand-back. */
  syncFromCamera(center: THREE.Vector3): void {
    this.flight?.kill();
    this.offset.copy(this.camera.position).sub(center);
    const radius = Math.max(this.offset.length(), 0.001);
    this.radius = this.goal.radius = radius;
    this.phi = this.goal.phi = Math.acos(clamp(this.offset.y / radius, -1, 1));
    this.theta = this.goal.theta = Math.atan2(this.offset.x, this.offset.z);
    this.target.copy(center);
    this.goal.x = center.x;
    this.goal.y = center.y;
    this.goal.z = center.z;
  }

  update(dt: number): void {
    if (this.follow) {
      this.goal.x = this.follow.position.x;
      this.goal.y = this.follow.position.y;
      this.goal.z = this.follow.position.z;
    }
    this.idle += dt;
    if (this.autoRotate !== 0 && this.idle > 2.5 && !this.flight?.isActive()) {
      this.goal.theta += this.autoRotate * dt;
    }

    this.theta = damp(this.theta, this.goal.theta, 7, dt);
    this.phi = damp(this.phi, this.goal.phi, 7, dt);
    this.radius = damp(this.radius, this.goal.radius, 6, dt);
    const k = 1 - Math.exp(-(this.follow ? 9 : 6) * dt);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.y += (this.goal.y - this.target.y) * k;
    this.target.z += (this.goal.z - this.target.z) * k;

    if (!this.active) return;
    const sinPhi = Math.sin(this.phi);
    this.offset.set(sinPhi * Math.sin(this.theta), Math.cos(this.phi), sinPhi * Math.cos(this.theta));
    this.camera.position.copy(this.target).addScaledVector(this.offset, this.radius);
    this.camera.lookAt(this.target);
  }

  /** Seconds since the player last dragged or zoomed. */
  get idleTime(): number {
    return this.idle;
  }

  /** Current orbit distance, used to size the shadow frustum. */
  get distance(): number {
    return this.radius;
  }

  private applyView(view: RigView): void {
    if (view.target) {
      this.goal.x = view.target.x;
      this.goal.y = view.target.y;
      this.goal.z = view.target.z;
    }
    if (view.theta !== undefined) this.goal.theta = view.theta;
    if (view.phi !== undefined) this.goal.phi = view.phi;
    if (view.radius !== undefined) this.goal.radius = view.radius;
  }

  private clampGoal(): void {
    this.goal.phi = clamp(this.goal.phi, this.limits.minPhi, this.limits.maxPhi);
    this.goal.radius = clamp(this.goal.radius, this.limits.minRadius, this.limits.maxRadius);
  }
}
