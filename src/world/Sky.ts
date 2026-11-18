import * as THREE from 'three';
import type { DayNight } from '../core/DayNight';
import { mulberry32 } from '../core/math';
import { shared } from './materials';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uFog;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uSunColor;
  uniform float uSun;
  uniform float uNight;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);

    vec3 color = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.85, up), 0.62));
    // Below the horizon the sky dissolves into the fog colour, so the sea has no hard edge.
    color = mix(color, uFog, smoothstep(0.06, -0.12, dir.y));

    float sunDot = max(dot(dir, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.55, uSunDir.y);
    color += uSunColor * pow(sunDot, 6.0) * (0.12 + 0.32 * low) * uSun;
    color += uSunColor * pow(sunDot, 90.0) * 0.55 * uSun;
    color += uSunColor * smoothstep(0.99925, 0.99962, sunDot) * 9.0 * uSun;

    float moonDot = max(dot(dir, uMoonDir), 0.0);
    vec3 moonColor = vec3(0.86, 0.91, 1.0);
    color += moonColor * smoothstep(0.99905, 0.99935, moonDot) * 2.6 * uNight;
    color += moonColor * pow(moonDot, 220.0) * 0.28 * uNight;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  void main() {
    vTwinkle = 0.7 + 0.3 * sin(uTime * (0.6 + fract(aPhase) * 1.6) + aPhase * 40.0);
    gl_PointSize = aSize * uPixelRatio * vTwinkle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.08, d) * uOpacity * vTwinkle;
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * 1.6, alpha);
  }
`;

/** Gradient sky dome with sun, moon and stars. It rides along with the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.ShaderMaterial;
  private readonly stars: THREE.ShaderMaterial;
  private readonly starField: THREE.Points;

  constructor(pixelRatio: number) {
    this.dome = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uSun: { value: 1 },
        uNight: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 20), this.dome);
    dome.renderOrder = -20;
    dome.frustumCulled = false;

    const rng = mulberry32(2026);
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const point = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      point.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (point.lengthSq() < 0.02) point.set(0, 1, 0);
      point.normalize().multiplyScalar(1700);
      positions.set([point.x, point.y, point.z], i * 3);
      sizes[i] = 1.2 + Math.pow(rng(), 6) * 3.4;
      phases[i] = rng() * 10;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.stars = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uTime: shared.time,
        uOpacity: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.starField = new THREE.Points(geometry, this.stars);
    this.starField.renderOrder = -19;
    this.starField.frustumCulled = false;
    this.starField.rotation.z = 0.5;

    this.group.add(dome, this.starField);
  }

  update(day: DayNight, camera: THREE.Camera, dt: number): void {
    this.group.position.copy(camera.position);
    const u = this.dome.uniforms as Record<string, THREE.IUniform>;
    (u.uTop!.value as THREE.Color).copy(day.top);
    (u.uHorizon!.value as THREE.Color).copy(day.horizon);
    (u.uFog!.value as THREE.Color).copy(day.fog);
    (u.uSunColor!.value as THREE.Color).copy(day.lightColor);
    (u.uSunDir!.value as THREE.Vector3).copy(day.sunDir);
    (u.uMoonDir!.value as THREE.Vector3).copy(day.moonDir);
    u.uSun!.value = day.sunVisibility;
    u.uNight!.value = day.night;

    this.stars.uniforms.uOpacity!.value = day.night * day.night;
    this.starField.visible = day.night > 0.02;
    this.starField.rotation.y += dt * 0.004;
  }
}
