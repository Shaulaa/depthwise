import * as THREE from 'three';
import type { IslandId } from '../content';
import { DayNight } from '../core/DayNight';
import { clamp } from '../core/math';
import { Airship } from './Airship';
import { Birds, Fireworks } from './ambient';
import { Beacon } from './Beacon';
import { Character } from './Character';
import { Clouds } from './Clouds';
import { buildIslands, type BuiltIsland } from './islands';
import { shared, updateGlows } from './materials';
import { Sky } from './Sky';
import { createOcean, updateWater } from './Water';

const SEA_LEVEL = -74;

/** Everything that lives in the 3D scene, and the per-frame bookkeeping that keeps it in sync. */
export class World {
  readonly scene = new THREE.Scene();
  readonly day = new DayNight();
  readonly ship = new Airship();
  readonly islands: Map<IslandId, BuiltIsland>;
  readonly fireworks: Fireworks;
  /** The sky sailor the player walks around the islands as. */
  readonly hero = new Character();
  /** One game spot per island. */
  readonly beacons = new Map<IslandId, Beacon>();

  private readonly fog = new THREE.FogExp2('#bcdcf4', 0.0011);
  private readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#666666', 1);
  private readonly sky: Sky;
  private readonly clouds = new Clouds();
  private readonly birds = new Birds();
  private time = 0;

  constructor(pixelRatio: number) {
    this.scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 700;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = new Sky(pixelRatio);
    this.fireworks = new Fireworks(pixelRatio);
    this.islands = buildIslands(pixelRatio);

    this.scene.add(this.sky.group, createOcean(SEA_LEVEL), this.clouds.mesh, this.birds.mesh, this.fireworks.group, this.ship.root);
    for (const built of this.islands.values()) {
      this.scene.add(built.group);
      const beacon = new Beacon(built.walk.station);
      this.beacons.set(built.id, beacon);
      this.scene.add(beacon.group);
    }
    this.scene.add(this.hero.root);

    const home = this.island('hub');
    this.ship.moor(home.dock.position, home.dock.yaw);
  }

  beacon(id: IslandId): Beacon {
    const beacon = this.beacons.get(id);
    if (!beacon) throw new Error(`Unknown island: ${id}`);
    return beacon;
  }

  island(id: IslandId): BuiltIsland {
    const built = this.islands.get(id);
    if (!built) throw new Error(`Unknown island: ${id}`);
    return built;
  }

  /**
   * @param focus Point the shadows should be centred on.
   * @param reach How far around it they need to cover.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, reach: number): void {
    this.time += dt;
    shared.time.value = this.time;
    const day = this.day;
    day.update(dt);

    this.fog.color.copy(day.fog);
    this.hemi.color.copy(day.hemiSky);
    this.hemi.groundColor.copy(day.hemiGround);
    this.hemi.intensity = day.hemiIntensity;
    this.sun.color.copy(day.lightColor);
    this.sun.intensity = day.lightIntensity;
    this.sun.position.copy(focus).addScaledVector(day.lightDir, 320);
    this.sun.target.position.copy(focus);

    const extent = clamp(reach, 42, 190);
    const shadowCamera = this.sun.shadow.camera;
    if (Math.abs(shadowCamera.right - extent) > 0.5) {
      shadowCamera.left = -extent;
      shadowCamera.right = extent;
      shadowCamera.top = extent;
      shadowCamera.bottom = -extent;
      shadowCamera.updateProjectionMatrix();
    }

    updateGlows(day.night);
    updateWater(day);
    this.sky.update(day, camera, dt);
    this.clouds.update(dt, day);
    this.birds.update(dt, this.time);
    this.fireworks.update(dt);
    this.ship.update(dt, this.time, day.night);
    for (const built of this.islands.values()) {
      built.update?.(dt, this.time, day);
      const beacon = this.beacons.get(built.id);
      if (!beacon) continue;
      beacon.group.visible = !built.gameActive;
      if (beacon.group.visible) beacon.update(dt, this.time, day.night);
    }
  }

  /** Seconds since the world started, for anything that wants to animate in step with it. */
  get elapsed(): number {
    return this.time;
  }
}
