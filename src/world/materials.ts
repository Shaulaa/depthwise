import * as THREE from 'three';
import { lerp } from '../core/math';

/** Uniforms shared by every animated shader in the world. */
export const shared = {
  time: { value: 0 },
};

/** Adds a cheap vertex sway. `amount` scales with the square of the local height. */
function withWind<T extends THREE.Material>(material: T, amount: number, speed: number): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 windSeed = instanceMatrix[3].xz;
        #else
          vec2 windSeed = vec2(0.0);
        #endif
        float windLift = max(position.y, 0.0);
        float windPhase = uTime * ${speed.toFixed(2)} + windSeed.x * 0.31 + windSeed.y * 0.27;
        float windSway = sin(windPhase) * 0.65 + sin(windPhase * 2.3 + 1.7) * 0.35;
        transformed.x += windSway * ${amount.toFixed(4)} * windLift * windLift;
        transformed.z += cos(windPhase * 0.8) * ${(amount * 0.6).toFixed(4)} * windLift * windLift;`,
      );
  };
  material.customProgramCacheKey = () => `wind-${amount}-${speed}`;
  return material;
}

/** Solid, vertex-coloured surfaces: terrain, buildings, props. */
export const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Tree crowns, tinted per instance. */
export const foliageMat = withWind(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.012, 1.3);

/** Grass tufts and flowers. */
export const grassMat = withWind(
  new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  0.34,
  1.9,
);

interface Glow {
  material: THREE.MeshBasicMaterial;
  base: THREE.Color;
  day: number;
  night: number;
}

const glows: Glow[] = [];

/**
 * Unlit material whose brightness follows the time of day. Night values above 1 push it
 * into HDR so the bloom pass picks it up.
 */
export function createGlow(color: THREE.ColorRepresentation, day: number, night: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color });
  glows.push({ material, base: new THREE.Color(color), day, night });
  return material;
}

export const windowGlow = createGlow('#ffcf8a', 0.16, 2.6);
export const lampGlow = createGlow('#ffd9a0', 0.7, 4.2);
export const sporeGlow = createGlow('#8ff3dc', 0.55, 3.4);

export function updateGlows(night: number): void {
  for (const glow of glows) {
    glow.material.color.copy(glow.base).multiplyScalar(lerp(glow.day, glow.night, night));
  }
}
