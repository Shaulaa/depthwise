import * as THREE from 'three';
import gsap from 'gsap';
import { TAU, lerp, smoothstep } from './math';

interface Keyframe {
  t: number;
  top: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  night: number;
}

const key = (
  t: number,
  top: string,
  horizon: string,
  fog: string,
  sun: string,
  hemiSky: string,
  hemiGround: string,
  hemi: number,
  night: number,
): Keyframe => ({
  t,
  top: new THREE.Color(top),
  horizon: new THREE.Color(horizon),
  fog: new THREE.Color(fog),
  sun: new THREE.Color(sun),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemi,
  night,
});

/** Time runs 0..1 over a day: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
const KEYS: Keyframe[] = [
  key(0.0, '#060a1e', '#1a2850', '#141f44', '#9db7ff', '#3a4a7c', '#141a30', 0.75, 1),
  key(0.2, '#0b1230', '#2b3466', '#1e2850', '#9db7ff', '#3d4b7e', '#161b33', 0.75, 1),
  key(0.255, '#2c4a8c', '#f59a78', '#c98a86', '#ff9d62', '#8f8bb0', '#4a3c4e', 0.9, 0.55),
  key(0.3, '#3d7fd2', '#ffd3a6', '#e6c7b4', '#ffc48a', '#b9cdea', '#6b6258', 1.05, 0.1),
  key(0.38, '#2f7edc', '#c6e4f8', '#bcdcf4', '#fff1dc', '#cfe4fa', '#7d7a66', 1.15, 0),
  key(0.5, '#2a78e0', '#bfe3fb', '#b8dcf6', '#ffffff', '#d6ebff', '#85826c', 1.2, 0),
  key(0.62, '#3078d8', '#cfe3f4', '#c4dcf0', '#fff0d6', '#d2e2f4', '#857c66', 1.18, 0),
  key(0.695, '#3c72c6', '#f7dcb2', '#e2d2c0', '#ffd49a', '#d0d6e6', '#7d6f5c', 1.14, 0),
  key(0.74, '#3a4f9e', '#ff9d68', '#e09a80', '#ffa468', '#c0a6b8', '#66504c', 1.08, 0.2),
  key(0.775, '#262a6a', '#e0607a', '#8a4e78', '#ff8a6a', '#8474a6', '#40324a', 0.95, 0.65),
  key(0.83, '#0f1440', '#4a3a78', '#2a2858', '#a9b9ff', '#454f86', '#1a1c38', 0.8, 1),
  key(1.0, '#060a1e', '#1a2850', '#141f44', '#9db7ff', '#3a4a7c', '#141a30', 0.75, 1),
];

export const PHASES = [
  { id: 'pagi', label: 'Pagi', time: 0.36 },
  { id: 'siang', label: 'Siang', time: 0.5 },
  { id: 'senja', label: 'Senja', time: 0.735 },
  { id: 'malam', label: 'Malam', time: 0.92 },
] as const;

export function phaseLabel(t: number): string {
  if (t < 0.21 || t >= 0.8) return 'Malam';
  if (t < 0.3) return 'Fajar';
  if (t < 0.44) return 'Pagi';
  if (t < 0.6) return 'Siang';
  if (t < 0.7) return 'Sore';
  return 'Senja';
}

export function clockLabel(t: number): string {
  const minutes = Math.floor((((t % 1) + 1) % 1) * 24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}.${m < 10 ? '0' : ''}${m}`;
}

/** Owns the time of day and derives every colour and light value the world needs from it. */
export class DayNight {
  /** 0..1, see KEYS. */
  time = 0.36;
  /** Seconds for one full day. */
  dayLength = 420;
  paused = false;

  readonly top = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly fog = new THREE.Color();
  readonly lightColor = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  readonly waterDeep = new THREE.Color();
  readonly waterShallow = new THREE.Color();
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** Direction towards whichever body is lighting the scene. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  lightIntensity = 1;
  hemiIntensity = 1;
  /** 0 in daylight, 1 at night. Drives windows, lanterns and stars. */
  night = 0;
  /** How strongly the sun disc shows, 0..1. */
  sunVisibility = 1;

  private tween: gsap.core.Tween | null = null;

  constructor() {
    this.update(0);
  }

  /** Glide forward in time to a moment of the day. */
  goTo(time: number, duration = 2.4): void {
    this.tween?.kill();
    const forward = (((time - this.time) % 1) + 1) % 1;
    const proxy = { t: this.time };
    this.tween = gsap.to(proxy, {
      t: this.time + forward,
      duration,
      ease: 'sine.inOut',
      onUpdate: () => {
        this.time = proxy.t % 1;
      },
    });
  }

  update(dt: number): void {
    if (!this.paused && !this.tween?.isActive()) this.time = (this.time + dt / this.dayLength) % 1;
    const t = this.time;

    let i = 0;
    while (i < KEYS.length - 2 && t >= (KEYS[i + 1] as Keyframe).t) i++;
    const a = KEYS[i] as Keyframe;
    const b = KEYS[i + 1] as Keyframe;
    const f = smoothstep(a.t, b.t, t);

    this.top.lerpColors(a.top, b.top, f);
    this.horizon.lerpColors(a.horizon, b.horizon, f);
    this.fog.lerpColors(a.fog, b.fog, f);
    this.hemiSky.lerpColors(a.hemiSky, b.hemiSky, f);
    this.hemiGround.lerpColors(a.hemiGround, b.hemiGround, f);
    this.lightColor.lerpColors(a.sun, b.sun, f);
    this.hemiIntensity = lerp(a.hemi, b.hemi, f);
    this.night = lerp(a.night, b.night, f);

    const angle = (t - 0.25) * TAU;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.42).normalize();
    this.moonDir.set(-Math.cos(angle), -Math.sin(angle), -0.3).normalize();

    // The directional light fades to zero at the horizon, which hides the sun/moon hand-over.
    const sunUp = this.sunDir.y > 0;
    if (sunUp) {
      this.lightDir.copy(this.sunDir);
      this.lightIntensity = smoothstep(0, 0.32, this.sunDir.y) * 3.1;
    } else {
      this.lightDir.copy(this.moonDir);
      this.lightIntensity = smoothstep(0, 0.4, this.moonDir.y) * 1.05;
    }
    // Keep the light off the exact horizon so shadows never stretch to infinity.
    if (this.lightDir.y < 0.14) this.lightDir.setY(0.14).normalize();
    this.sunVisibility = smoothstep(-0.12, 0.02, this.sunDir.y);

    this.waterDeep.copy(this.top).multiplyScalar(0.42).lerp(this.fog, 0.08);
    this.waterShallow.copy(this.top).lerp(this.horizon, 0.32);
  }
}
