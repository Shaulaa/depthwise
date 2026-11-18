import * as THREE from 'three';
import type { DayNight } from '../core/DayNight';
import { shared } from './materials';

/** Colour and light uniforms shared by every water surface, refreshed once per frame. */
const env = {
  uTime: shared.time,
  uDeep: { value: new THREE.Color() },
  uShallow: { value: new THREE.Color() },
  uSky: { value: new THREE.Color() },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightColor: { value: new THREE.Color() },
  uLight: { value: 1 },
  uAmbient: { value: new THREE.Color() },
};

export function updateWater(day: DayNight): void {
  env.uDeep.value.copy(day.waterDeep);
  env.uShallow.value.copy(day.waterShallow);
  env.uSky.value.copy(day.horizon);
  env.uLightDir.value.copy(day.lightDir);
  env.uLightColor.value.copy(day.lightColor);
  env.uLight.value = day.lightIntensity;
  env.uAmbient.value.copy(day.hemiSky).multiplyScalar(day.hemiIntensity);
}

const NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const WATER_VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLight;
  uniform float uScale;
  uniform float uOpacity;
  varying vec3 vWorld;
  ${NOISE}

  // Sum of travelling sine waves; returns the surface gradient in xy and height in z.
  vec3 waves(vec2 p) {
    vec3 acc = vec3(0.0);
    float freq = 0.045 * uScale;
    float amp = 1.0;
    vec2 dir = normalize(vec2(1.0, 0.35));
    for (int i = 0; i < 5; i++) {
      float phase = dot(dir, p) * freq + uTime * (0.55 + float(i) * 0.21);
      acc.z += amp * sin(phase);
      acc.xy += amp * freq * dir * cos(phase) * (5.0 / uScale);
      dir = normalize(vec2(dir.x * 0.42 - dir.y * 0.91, dir.x * 0.91 + dir.y * 0.42));
      freq *= 1.72;
      amp *= 0.6;
    }
    return acc;
  }

  void main() {
    vec3 w = waves(vWorld.xz);
    vec3 normal = normalize(vec3(-w.x, 1.0, -w.y));
    vec3 view = normalize(cameraPosition - vWorld);

    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
    vec3 color = mix(uDeep, uShallow, clamp(0.28 + w.z * 0.12, 0.0, 1.0));
    color = mix(color, uSky, fresnel * 0.5);

    // Soft foam streaks riding the wave crests.
    float foam = vnoise(vWorld.xz * 0.05 * uScale + vec2(uTime * 0.05, uTime * 0.03));
    foam = smoothstep(0.62, 0.8, foam + w.z * 0.09);
    color = mix(color, uSky + 0.12, foam * 0.2);

    vec3 halfway = normalize(uLightDir + view);
    float spec = pow(max(dot(normal, halfway), 0.0), 260.0);
    float sheen = pow(max(dot(normal, halfway), 0.0), 26.0);
    // Glints thin out with distance, where the wave normals would otherwise alias into noise.
    float near = smoothstep(1500.0, 150.0, distance(cameraPosition, vWorld));
    color += uLightColor * (spec * 2.6 * near + sheen * 0.05) * uLight * 0.4;

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function waterMaterial(scale: number, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...env,
      uScale: { value: scale },
      uOpacity: { value: opacity },
    },
    fog: true,
    transparent: opacity < 1,
  });
}

/** The sea far below the archipelago. */
export function createOcean(y: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(7000, 7000);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, waterMaterial(1, 1));
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return mesh;
}

let pondMaterial: THREE.ShaderMaterial | null = null;

/** Still water sitting in an island pit. */
export function createPond(radius: number): THREE.Mesh {
  pondMaterial ??= waterMaterial(9, 0.86);
  const geometry = new THREE.CircleGeometry(radius, 20);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, pondMaterial);
}

const FALL_VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FALL_FRAGMENT = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uLength;
  uniform vec3 uShallow;
  uniform vec3 uAmbient;
  varying vec2 vUv;
  ${NOISE}

  void main() {
    float fall = 1.0 - vUv.y; // 0 at the lip, 1 at the bottom
    vec2 p = vec2(vUv.x * 9.0, fall * uLength * 0.45 - uTime * 2.6);
    float streak = vnoise(p) * 0.65 + vnoise(p * vec2(2.3, 0.6) + 7.0) * 0.35;
    streak = smoothstep(0.38, 0.72, streak);

    vec3 water = mix(uShallow * 1.15, vec3(1.0), 0.35);
    vec3 color = mix(water, vec3(1.0), streak) * (0.35 + uAmbient * 0.75);
    // The fall thins into mist before it reaches the sea.
    float alpha = (0.9 - 0.25 * (1.0 - streak)) * smoothstep(1.0, 0.45, fall);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Half-tube of falling water. Its top edge sits on the local origin and it bulges along +z. */
export function createWaterfall(width: number, length: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(width / 2, width * 0.7, length, 10, 1, true, -Math.PI / 2, Math.PI);
  geometry.translate(0, -length / 2, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: FALL_VERTEX,
    fragmentShader: FALL_FRAGMENT,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: env.uTime,
      uShallow: env.uShallow,
      uAmbient: env.uAmbient,
      uLength: { value: length },
    },
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}
