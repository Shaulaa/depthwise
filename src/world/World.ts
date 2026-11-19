import * as THREE from 'three';
import { NPCS, type IslandId, type NpcInfo } from '../content';
import { DayNight } from '../core/DayNight';
import { clamp, mulberry32 } from '../core/math';
import { Airship } from './Airship';
import { Birds, Fireflies, Fireworks } from './ambient';
import { Beacon } from './Beacon';
import { Character } from './Character';
import { Clouds } from './Clouds';
import { Dust } from './Dust';
import { Feathers } from './Feathers';
import { Npc } from './Npc';
import { groundAt, pushOutOfBlockers, type WalkArea } from './Walk';
import { buildIslands, type BuiltIsland } from './islands';
import { shared, updateGlows } from './materials';
import { Sky } from './Sky';
import { createOcean, updateWater } from './Water';
import { Weather, type WeatherKind } from './Weather';
import { Wildlife, type Habitat } from './Wildlife';

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
  /** Islanders, each living on one island. */
  readonly npcs: Npc[] = [];
  readonly feathers: Feathers;
  readonly dust = new Dust();
  readonly weather: Weather;
  /** Set by `update` when the weather turned on its own this frame. */
  weatherChange: WeatherKind | null = null;
  /** Birds that took off this frame. */
  birdsFlushed = 0;

  private readonly fog = new THREE.FogExp2('#bcdcf4', 0.0011);
  private readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#666666', 1);
  private readonly sky: Sky;
  private readonly clouds = new Clouds();
  private readonly birds = new Birds();
  private readonly wildlife: Wildlife;
  /** Night-time motes on every island but Rimba, which has its own swarm. */
  private readonly fireflies: Fireflies[] = [];
  private readonly walkers: THREE.Vector3[] = [];
  private time = 0;

  /** @param rainDrops Fewer on phones, where every streak costs fill rate. */
  constructor(pixelRatio: number, rainDrops = 2400) {
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
    this.scene.add(this.hero.root, this.dust.mesh);

    this.feathers = new Feathers([...this.islands.values()].map((built) => ({ island: built.id, points: built.walk.feathers })));
    this.scene.add(this.feathers.group);

    for (const info of NPCS) {
      const built = this.island(info.island);
      const { home, yaw } = this.npcHome(built, info);
      const npc = new Npc(info, World.walkArea(built), built.group.position, home, yaw);
      this.npcs.push(npc);
      this.scene.add(npc.figure.root);
    }

    this.weather = new Weather(rainDrops);
    this.scene.add(this.weather.group);

    const habitats: Habitat[] = [];
    for (const built of this.islands.values()) {
      const area = World.walkArea(built);
      const rng = mulberry32(built.island.shape.seed * 71 + 3);
      const avoid = area.blockers.map((b) => ({ x: b.x, z: b.z, r: b.r + 0.6 }));
      const spots = built.island.scatter(rng, 14, { margin: 0.14, minFlatness: 0.86, avoid, spacing: 2.5 });
      habitats.push({ area, origin: built.group.position, spots: spots.map((p) => ({ x: p.x, z: p.z })) });
      if (built.id !== 'rimba') {
        const motes = new Fireflies(built.island.scatter(rng, 28, { margin: 0.1, minFlatness: 0.6 }), pixelRatio);
        built.group.add(motes.points);
        this.fireflies.push(motes);
      }
    }
    this.wildlife = new Wildlife(habitats);
    this.scene.add(this.wildlife.group);

    const home = this.island('hub');
    this.ship.moor(home.dock.position, home.dock.yaw);
  }

  /** What a character needs to walk around an island. */
  static walkArea(built: BuiltIsland): WalkArea {
    const { blockers, platforms, stairs } = built.walk;
    return { ground: built.island, blockers, platforms, stairs };
  }

  /** Turn an islander's home description into a clear spot on the ground, facing the island's middle. */
  private npcHome(built: BuiltIsland, info: NpcInfo): { home: THREE.Vector3; yaw: number } {
    const g = built.group.position;
    const anchor = info.home.from === 'pier' ? built.walk.pier : built.walk.station;
    const inward = new THREE.Vector3(g.x - anchor.x, 0, g.z - anchor.z);
    if (inward.lengthSq() < 1e-6) inward.set(0, 0, 1);
    inward.normalize();
    const local = {
      x: anchor.x - g.x + inward.x * info.home.towards - inward.z * info.home.side,
      z: anchor.z - g.z + inward.z * info.home.towards + inward.x * info.home.side,
    };
    const area = World.walkArea(built);
    pushOutOfBlockers(area, local, 0.6);
    if (groundAt(area, local.x, local.z) === null) {
      local.x = anchor.x - g.x;
      local.z = anchor.z - g.z;
    }
    const home = new THREE.Vector3(local.x + g.x, 0, local.z + g.z);
    return { home, yaw: Math.atan2(inward.x, inward.z) };
  }

  /** Islanders standing on an island. */
  npcsOn(id: IslandId): Npc[] {
    return this.npcs.filter((npc) => npc.info.island === id);
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
    this.weatherChange = this.weather.update(dt);
    this.weather.apply(day);
    this.fog.density = this.weather.fogDensity;

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
    this.sky.update(day, camera, dt, this.weather.clearSky);
    this.weather.place(camera, day);
    this.clouds.update(dt, day);
    this.birds.update(dt, this.time);
    this.fireworks.update(dt);
    this.feathers.update(this.time, day.night);
    this.dust.update(dt);
    const { rain } = this.weather.cycle.level;
    for (const motes of this.fireflies) motes.update(day.night * (1 - rain));
    this.walkers.length = 0;
    if (this.hero.visible) this.walkers.push(this.hero.root.position);
    for (const npc of this.npcs) this.walkers.push(npc.position);
    this.birdsFlushed = this.wildlife.update(dt, this.time, this.walkers, { rain, night: day.night }, this.hero.visible ? this.hero.root.position : null);
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
