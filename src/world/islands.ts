import * as THREE from 'three';
import type { IslandId } from '../content';
import type { DayNight } from '../core/DayNight';
import { TAU, lerp, mulberry32, pick, range, shortestAngle, type Rng } from '../core/math';
import { KEEL_DEPTH } from './Airship';
import { Fireflies, PaperLanterns } from './ambient';
import { box, cyl } from './geo';
import { Island, type IslandPalette, type IslandShape, type Pit } from './Island';
import { lampGlow, solidMat, sporeGlow, windowGlow } from './materials';
import { MOSAIC_SIZE, drawMosaic } from './mosaic';
import * as props from './props';
import { flowers, grass, rocks, trees } from './vegetation';
import type { Blocker, Platform, Stair } from './Walk';
import { createPond, createWaterfall } from './Water';

export interface GameLantern {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  color: THREE.Color;
}

/** A solid vertical cylinder the airship must fly around, in world space. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  bottom: number;
  top: number;
}

/** What a character on foot needs. Blockers and platforms are in island space, points in world space. */
export interface WalkData {
  blockers: Blocker[];
  platforms: Platform[];
  stairs: Stair[];
  /** Collectable wind feathers, world space; the id of each is "<island>-<index>". */
  feathers: THREE.Vector3[];
  /** Where the character steps onto the pier from the ship. */
  pier: THREE.Vector3;
  /** Glowing spot that starts the island's game (or opens the stamp book at the harbour). */
  station: THREE.Vector3;
}

/** A finished island plus the anchors the rest of the app needs, all in world space. */
export interface BuiltIsland {
  id: IslandId;
  island: Island;
  group: THREE.Group;
  /** Orbit centre for the camera. */
  focus: THREE.Vector3;
  view: { theta: number; phi: number; radius: number };
  dock: { position: THREE.Vector3; yaw: number; outward: THREE.Vector3 };
  /** Rough bounds for click picking on the map. */
  bounds: THREE.Sphere;
  /** Where the map label floats. */
  label: THREE.Vector3;
  /** Set while a mini game owns the island's interactive props. */
  gameActive: boolean;
  /** Harbour only: the lighthouse burns brighter once every stamp is collected. */
  lit?: boolean;
  /** Pulau Ubin only: the mosaic has been put back together. */
  restored?: boolean;
  update?: (dt: number, time: number, day: DayNight) => void;
  /** Solid things that stick out of the island's height field: islets, towers. */
  obstacles: Obstacle[];
  puzzleOrigin?: THREE.Vector3;
  crystalSpots?: THREE.Vector3[];
  court?: THREE.Vector3;
  lanterns?: GameLantern[];
  walk: WalkData;
}

interface Ctx {
  built: BuiltIsland;
  island: Island;
  group: THREE.Group;
  kit: props.Kit;
  rng: Rng;
  /** Circles scattered vegetation must stay out of. */
  avoid: { x: number; z: number; r: number }[];
  pixelRatio: number;
  world: (x: number, y: number, z: number) => THREE.Vector3;
  /** Mark a circle (island space) as solid for a character on foot. */
  block: (x: number, z: number, r: number) => void;
  /** Put the island's game spot on the ground at a point (island space). */
  station: (x: number, z: number, y?: number) => void;
}

interface Layout {
  id: IslandId;
  position: [number, number, number];
  dockAngle: number;
  view: { theta: number; phi: number; radius: number };
  /** Height of the camera focus above the rim. */
  lift: number;
  labelHeight: number;
  shape: IslandShape;
  dress: (c: Ctx) => void;
}

const meadow: IslandPalette = {
  grassA: '#7cc260',
  grassB: '#5fae58',
  sand: '#d9c58f',
  soil: '#8a6a4a',
  cliff: '#9b8f7f',
  rockA: '#8b7d74',
  rockB: '#4d4658',
};

// ---------------------------------------------------------------- helpers

function addPond(c: Ctx, pit: Pit): number {
  let level = Infinity;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    level = Math.min(level, c.island.heightAt(pit.x + Math.cos(a) * pit.r * 0.98, pit.z + Math.sin(a) * pit.r * 0.98));
  }
  level -= 0.24;
  const pond = createPond(pit.r * 0.97);
  pond.position.set(pit.x, level, pit.z);
  c.group.add(pond);
  return level;
}

/** A spring bursting out of the cliff just under the rim. */
function addWaterfall(c: Ctx, theta: number, width: number, length: number): void {
  const r = c.island.rimRadius(theta) - 0.8;
  const x = Math.cos(theta) * r;
  const z = Math.sin(theta) * r;
  const ry = Math.PI / 2 - theta;
  const fall = createWaterfall(width, length);
  fall.position.set(x, -0.3, z);
  fall.rotation.y = ry;
  c.group.add(fall);
  c.kit.solid.add(box(width + 1.3, 0.9, 2.2, c.island.shape.palette.cliff), {
    x: Math.cos(theta) * (r - 0.5),
    y: -0.05,
    z: Math.sin(theta) * (r - 0.5),
    ry,
  });
}

/** Small satellite rocks. Returns the top of each one, in island space. */
function addIslets(c: Ctx, spots: readonly [angle: number, gap: number, y: number, radius: number][]): THREE.Vector3[] {
  return spots.map(([angle, gap, y, radius], i) => {
    const islet = new Island({
      seed: c.island.shape.seed * 31 + i,
      radius,
      depth: radius * 1.6,
      plateau: 0.5,
      hills: 0.3,
      lobes: 2,
      rings: 4,
      segments: 12,
      palette: c.island.shape.palette,
    });
    const r = c.island.rimRadius(angle) + gap;
    islet.mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    c.group.add(islet.mesh);
    const top = c.world(islet.mesh.position.x, y + islet.heightAt(0, 0), islet.mesh.position.z);
    // Islets carry a tree or two, hence the extra height on top.
    c.built.obstacles.push({ x: top.x, z: top.z, r: radius * 1.05, bottom: top.y - radius * 1.7, top: top.y + 4 });
    return new THREE.Vector3(islet.mesh.position.x, y + islet.heightAt(0, 0), islet.mesh.position.z);
  });
}

interface Greenery {
  round?: { count: number; colors: string[]; extra?: THREE.Vector3[]; size?: [number, number] };
  pine?: { count: number; colors: string[]; size?: [number, number]; maxY?: number };
  grass: { count: number; colors: string[] };
  flowers: { count: number; colors: string[] };
  rocks: { count: number; colors: string[]; size?: [number, number] };
}

function plant(c: Ctx, g: Greenery): void {
  const { island, rng, group, avoid } = c;
  const snow = island.shape.snowLine;
  const below = snow === undefined ? undefined : snow - 1.2;

  if (g.round) {
    const points = island.scatter(rng, g.round.count, { avoid, pad: 1.4, spacing: 2.4, margin: 0.1, maxY: below });
    group.add(trees('round', [...points, ...(g.round.extra ?? [])], rng, g.round.colors, g.round.size));
    for (const p of points) {
      avoid.push({ x: p.x, z: p.z, r: 0.7 });
      c.block(p.x, p.z, 0.42);
    }
  }
  if (g.pine) {
    const points = island.scatter(rng, g.pine.count, {
      avoid,
      pad: 1.2,
      spacing: 2.0,
      margin: 0.09,
      minFlatness: 0.7,
      maxY: g.pine.maxY ?? below,
    });
    group.add(trees('pine', points, rng, g.pine.colors, g.pine.size));
    for (const p of points) {
      avoid.push({ x: p.x, z: p.z, r: 0.6 });
      c.block(p.x, p.z, 0.36);
    }
  }
  group.add(
    rocks(island.scatter(rng, g.rocks.count, { avoid, margin: 0.03, minFlatness: 0.55, spacing: 1.2 }), rng, g.rocks.colors, g.rocks.size),
    grass(island.scatter(rng, g.grass.count, { avoid, margin: 0.05, minFlatness: 0.76, maxY: below }), rng, g.grass.colors),
    flowers(island.scatter(rng, g.flowers.count, { avoid, margin: 0.07, maxY: below }), rng, g.flowers.colors),
  );
}

// ---------------------------------------------------------------- Labuan Fajar

function dressHub(c: Ctx): void {
  const { island, kit, rng, group, avoid } = c;
  const plaza = { x: -3, z: 2 };
  const plazaY = 2.5;
  const dockDir = Math.atan2(9 - plaza.z, 28 - plaza.x);

  props.fountain(kit, { x: plaza.x, y: plazaY, z: plaza.z });
  c.block(plaza.x, plaza.z, 1.85);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.5;
    const x = plaza.x + Math.cos(a) * 5.5;
    const z = plaza.z + Math.sin(a) * 5.5;
    props.lampPost(kit, { x, y: plazaY, z });
    c.block(x, z, 0.14);
  }
  // The stamp book waits on the dock side of the fountain.
  c.station(plaza.x + Math.cos(dockDir) * 3.4, plaza.z + Math.sin(dockDir) * 3.4);

  const walls = ['#f3e7d0', '#efe0c4', '#f6efe2', '#e9d8bd'];
  const roofs = ['#c8553d', '#2f7f86', '#d39a3a', '#8a4b6a', '#3f6aa8'];
  const lots = 11;
  for (let i = 0; i < lots; i++) {
    const a = (i / lots) * TAU + 0.15;
    if (Math.abs(shortestAngle(a, dockDir)) < 0.42) continue; // keep the road to the dock open
    const r = 10.4 + (i % 2) * 3.2 + rng() * 0.6;
    const x = plaza.x + Math.cos(a) * r;
    const z = plaza.z + Math.sin(a) * r;
    if (!island.canPlace(x, z, { pad: 2, minFlatness: 0.6, margin: 0.2 })) continue;
    const size = {
      w: range(rng, 2.6, 3.5),
      d: range(rng, 2.7, 3.6),
      h: range(rng, 1.9, 2.8),
      wall: pick(rng, walls),
      roof: pick(rng, roofs),
      chimney: rng() < 0.6,
    };
    props.house(kit, { x, y: island.heightAt(x, z) - 0.05, z, ry: Math.atan2(plaza.x - x, plaza.z - z) }, size);
    avoid.push({ x, z, r: 3.3 });
    c.block(x, z, Math.max(size.w, size.d) / 2 + 0.2);
  }

  // Lighthouse on its hill, with a beam that only shows once the sky darkens.
  const tower = { x: -14, z: -11, y: 5.6 };
  const lampHeight = props.lighthouse(kit, { x: tower.x, y: tower.y, z: tower.z, ry: 0.9 });
  c.block(tower.x, tower.z, 2.5);
  const base = c.world(tower.x, tower.y, tower.z);
  c.built.obstacles.push({ x: base.x, z: base.z, r: 2.4, bottom: base.y - 4, top: base.y + lampHeight + 1.9 });
  const beam = props.lighthouseBeam();
  beam.object.position.set(tower.x, tower.y + lampHeight, tower.z);
  group.add(beam.object);

  const pit = (island.shape.pits as Pit[])[0] as Pit;
  addPond(c, pit);
  addWaterfall(c, 2.25, 3.2, 36);

  const tops = addIslets(c, [
    [1.5, 7, -6, 3.6],
    [3.6, 10, -13, 4.6],
    [5.2, 6, 3, 2.6],
  ]);
  plant(c, {
    round: { count: 46, colors: ['#5fb05a', '#4c9f58', '#74bd63', '#3f9160'], extra: tops },
    pine: { count: 12, colors: ['#3d7f5a', '#34704f'] },
    grass: { count: 900, colors: ['#7cc662', '#69b85a', '#8fd070'] },
    flowers: { count: 170, colors: ['#ffffff', '#ffd76a', '#ff9db0', '#c9a8ff'] },
    rocks: { count: 26, colors: ['#b3aa9c', '#9d9588', '#c4bcae'] },
  });

  c.built.update = (dt, _time, day) => {
    beam.object.rotation.y += dt * 0.45;
    const lit = c.built.lit === true;
    beam.material.opacity = lit ? 0.1 + 0.5 * day.night : 0.34 * day.night;
    beam.object.visible = lit || day.night > 0.02;
  };
}

// ---------------------------------------------------------------- Pulau Ubin

function dressUbin(c: Ctx): void {
  const { island, kit, rng } = c;
  const plazaY = 2.3;

  // Raised slab the sliding tiles sit on.
  kit.solid.add(box(11.6, 0.6, 11.6, '#bdb298'), { y: plazaY + 0.2 });
  kit.solid.add(box(12.4, 0.3, 12.4, '#a79c84'), { y: plazaY + 0.05 });
  c.built.puzzleOrigin = c.world(0, plazaY + 0.5, 0);
  // The tiles are a step up from the plaza, and fine to walk on.
  c.built.walk.platforms.push({ x: 0, z: 0, ry: 0, hx: 5.8, hz: 5.8, y: plazaY + 0.64 });
  c.station(0, 7.4);

  // Bare stone tiles while the picture is lost; the game lays its sliding tiles over them.
  const tile = 3.4;
  const stones = ['#c9bea4', '#c2b69b', '#d0c6ad'];
  for (let i = 0; i < MOSAIC_SIZE * MOSAIC_SIZE; i++) {
    kit.solid.add(box(tile - 0.16, 0.14, tile - 0.16, stones[i % stones.length] as string), {
      x: ((i % MOSAIC_SIZE) - 1) * tile,
      y: plazaY + 0.57,
      z: (Math.floor(i / MOSAIC_SIZE) - 1) * tile,
    });
  }

  // The finished mosaic, shown once the puzzle has been solved.
  const texture = new THREE.CanvasTexture(drawMosaic(false));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const picture = new THREE.PlaneGeometry(tile * MOSAIC_SIZE - 0.16, tile * MOSAIC_SIZE - 0.16);
  picture.rotateX(-Math.PI / 2);
  const mosaic = new THREE.Mesh(picture, new THREE.MeshLambertMaterial({ map: texture }));
  mosaic.position.set(0, plazaY + 0.66, 0);
  mosaic.receiveShadow = true;
  mosaic.visible = false;
  c.group.add(mosaic);
  c.built.update = () => {
    mosaic.visible = c.built.restored === true && !c.built.gameActive;
  };

  // Ring of columns, left open towards the default camera on +z.
  const ringCount = 12;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * TAU + Math.PI / ringCount;
    if (Math.abs(shortestAngle(a, Math.PI / 2)) < 0.6) continue;
    const broken = rng() < 0.45;
    props.column(
      kit,
      { x: Math.cos(a) * 8.5, y: plazaY, z: Math.sin(a) * 8.5, ry: rng() * TAU },
      broken ? range(rng, 1.0, 2.4) : range(rng, 3.4, 5.0),
      broken,
    );
    c.block(Math.cos(a) * 8.5, Math.sin(a) * 8.5, 0.62);
  }
  for (const [x, z, ry] of [
    [0, -11.4, 0],
    [-11.4, 0, Math.PI / 2],
    [11.4, 0, Math.PI / 2],
  ] as const) {
    props.arch(kit, { x, y: island.heightAt(x, z) - 0.1, z, ry });
    c.avoid.push({ x, z, r: 3.4 });
    // Only the two pillars are solid; the way through stays open.
    for (const side of [-1, 1]) c.block(x + Math.cos(ry) * 1.9 * side, z - Math.sin(ry) * 1.9 * side, 0.6);
  }

  for (const p of island.scatter(rng, 16, { avoid: c.avoid, pad: 1, spacing: 2.6 })) {
    const transform = { x: p.x, y: p.y, z: p.z, ry: rng() * TAU, rz: rng() < 0.3 ? 0.2 : 0 };
    const w = range(rng, 0.8, 1.8);
    const h = range(rng, 0.5, 1.1);
    const d = range(rng, 0.8, 1.4);
    props.stoneBlock(kit, transform, w, h, d);
    c.avoid.push({ x: p.x, z: p.z, r: 1.2 });
    c.block(p.x, p.z, Math.max(w, d) / 2);
  }

  const tops = addIslets(c, [
    [0.4, 6, -5, 3.0],
    [4.4, 9, 6, 2.4],
  ]);
  plant(c, {
    round: { count: 9, colors: ['#93a558', '#a6b064', '#7f9650'], extra: tops },
    pine: { count: 18, colors: ['#4f6f47', '#5b7a4c', '#466642'], size: [0.9, 1.6] },
    grass: { count: 520, colors: ['#b9bd72', '#a4ad62', '#c9c583'] },
    flowers: { count: 70, colors: ['#f2d16b', '#e98a5a', '#ffffff'] },
    rocks: { count: 32, colors: ['#cdbf9f', '#b9a98a', '#a39478'] },
  });
}

// ---------------------------------------------------------------- Rimba Kunang

function dressRimba(c: Ctx): void {
  const { island, kit, rng, group, avoid } = c;
  const cabin = { x: -3, z: -12, y: 2.9 };
  props.house(
    kit,
    { x: cabin.x, y: cabin.y, z: cabin.z, ry: 0.25 },
    { w: 3.6, d: 3.2, h: 2.3, wall: '#7a5a44', roof: '#3d4a5c', chimney: true },
  );
  props.lampPost(kit, { x: cabin.x + 2.6, y: cabin.y, z: cabin.z + 2.2 }, 1.9);
  c.block(cabin.x, cabin.z, 2.3);
  c.block(cabin.x + 2.6, cabin.z + 2.2, 0.14);
  c.station(cabin.x + 0.6, cabin.z + 3.7);

  const pit = (island.shape.pits as Pit[])[0] as Pit;
  const waterLevel = addPond(c, pit);
  addWaterfall(c, -0.72, 3.4, 32);

  const caps = ['#d2504a', '#8f5bb0', '#e08a3c', '#4c8fb5'];
  const shrooms = island.scatter(rng, 9, { avoid, pad: 2, spacing: 5.5, margin: 0.14 });
  const sizes = shrooms.map(() => range(rng, 0.75, 1.75));
  shrooms.forEach((p, i) => {
    props.mushroom(kit, { x: p.x, y: p.y - 0.1, z: p.z, ry: rng() * TAU, s: sizes[i] }, pick(rng, caps));
    avoid.push({ x: p.x, z: p.z, r: 1.6 * (sizes[i] as number) });
    c.block(p.x, p.z, 0.42 * (sizes[i] as number));
  });

  const tops = addIslets(c, [
    [2.2, 8, -4, 3.4],
    [3.9, 6, 5, 2.6],
    [5.4, 11, -10, 4.2],
  ]);
  plant(c, {
    pine: { count: 90, colors: ['#2f6b4f', '#3a7a56', '#28604a', '#417f5a'], size: [0.9, 1.7] },
    round: { count: 38, colors: ['#3f8f5e', '#2f7f6a', '#56a064'], extra: tops.slice(1) },
    grass: { count: 900, colors: ['#3f9a62', '#4aa86c', '#2f8456'] },
    flowers: { count: 120, colors: ['#bfe9ff', '#d9c2ff', '#fff2a8'] },
    rocks: { count: 46, colors: ['#7b8494', '#69707e', '#8d95a3'], size: [0.4, 1.6] },
  });

  const fireflies = new Fireflies(island.scatter(rng, 110, { margin: 0.04, minFlatness: 0.4 }), c.pixelRatio);
  group.add(fireflies.points);

  // Hiding places for the crystal hunt, from easy to sneaky.
  const hill = (island.shape.bumps ?? [])[0] ?? { x: 0, z: 0 };
  const bigShroom = sizes.indexOf(Math.max(...sizes));
  const shroom = shrooms[bigShroom] as THREE.Vector3;
  const islet = tops[0] as THREE.Vector3;
  c.built.crystalSpots = [
    c.world(pit.x + 1.3, waterLevel + 0.35, pit.z - 0.9),
    c.world(shroom.x, shroom.y + 2.98 * (sizes[bigShroom] as number) + 0.45, shroom.z),
    c.world(hill.x, island.heightAt(hill.x, hill.z) + 0.7, hill.z),
    c.world(cabin.x - 2.7, cabin.y + 0.6, cabin.z - 1.4),
    c.world(islet.x, islet.y + 0.8, islet.z),
    // Tucked against the underside on the far side from the default view: only visible from below.
    c.world(-6, island.underAt(-6, -11) - 0.9, -11),
  ];

  c.built.update = (_dt, _time, day) => fireflies.update(day.night);
}

// ---------------------------------------------------------------- Tanjung Angin

function dressAngin(c: Ctx): void {
  const { island, kit, group } = c;
  const rotors: { mesh: THREE.Mesh; speed: number }[] = [];

  // The race is flown in the airship, so its starting spot sits just inland of the pier.
  const out = c.built.dock.outward;
  const inland = island.rimRadius(Math.atan2(out.z, out.x)) - 6;
  c.station(out.x * inland - out.z * 2.5, out.z * inland + out.x * 2.5);

  for (const flat of island.shape.flats ?? []) {
    const ry = Math.atan2(flat.x, flat.z);
    const hub = props.windmill(kit, { x: flat.x, y: flat.y, z: flat.z, ry });
    const rotor = props.windmillRotor();
    rotor.rotation.order = 'YXZ';
    rotor.rotation.y = ry;
    rotor.position.set(flat.x + Math.sin(ry) * hub.z, flat.y + hub.y, flat.z + Math.cos(ry) * hub.z);
    group.add(rotor);
    rotors.push({ mesh: rotor, speed: 0.9 + rotors.length * 0.25 });
    c.block(flat.x, flat.z, 1.45);
  }

  // Wind vanes dotted across the meadow.
  for (const p of island.scatter(c.rng, 5, { avoid: c.avoid, pad: 2, spacing: 6 })) {
    kit.solid.add(cyl(0.05, 0.07, 3.2, 5, '#5e3f2c'), { x: p.x, y: p.y + 1.6, z: p.z });
    kit.solid.add(box(1.3, 0.5, 0.05, '#e0583d'), { x: p.x + 0.7, y: p.y + 2.9, z: p.z, ry: 0.3 });
    c.avoid.push({ x: p.x, z: p.z, r: 1 });
    c.block(p.x, p.z, 0.12);
  }

  const tops = addIslets(c, [
    [1.2, 7, -4, 2.8],
    [2.9, 9, 5, 3.4],
    [4.6, 12, -9, 2.4],
  ]);
  plant(c, {
    round: { count: 14, colors: ['#9fb35a', '#b9bd5e', '#d1a84a', '#c98d47'], extra: tops },
    pine: { count: 12, colors: ['#5b8256', '#4d744e'], maxY: 6 },
    grass: { count: 820, colors: ['#cfc56b', '#bdbb62', '#d9cf7c', '#a9b25a'] },
    flowers: { count: 100, colors: ['#ffffff', '#f6d365', '#e77f67'] },
    rocks: { count: 42, colors: ['#a59f96', '#8d877f', '#bab3a8'], size: [0.3, 1.3] },
  });

  c.built.update = (dt) => {
    for (const rotor of rotors) rotor.mesh.rotation.z -= dt * rotor.speed;
  };
}

// ---------------------------------------------------------------- Bukit Lentera

const LANTERN_COLORS = ['#ff7a5c', '#ffc857', '#7fe3a0', '#6cc6ff', '#c79bff'];

function dressLentera(c: Ctx): void {
  const { island, kit, group, avoid } = c;
  const courtY = 6.2;
  c.built.court = c.world(0, courtY, 0);

  // Approach: gate, steps, gate.
  const foot = new THREE.Vector3(0, island.heightAt(0, 14.6), 14.6);
  const head = new THREE.Vector3(0, courtY, 6.7);
  const steps = props.stairs(kit, foot, head, 3.2, '#a69fb3');
  // Walk on the treads themselves rather than the slope of the hill beneath them.
  c.built.walk.stairs.push({ from: foot.clone(), to: head.clone(), halfWidth: 1.6, steps });
  props.gate(kit, { x: 0, y: foot.y - 0.1, z: 16.2 });
  for (const side of [-1, 1]) c.block(side * 1.6, 16.2, 0.4);
  // The head of the steps stays open so nothing stands between the camera and the lanterns.
  for (const side of [-1, 1]) {
    props.stoneLantern(kit, { x: side * 2.5, y: courtY, z: 5.7 });
    c.block(side * 2.5, 5.7, 0.36);
  }
  c.station(0, 4.2, courtY);
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    const z = lerp(15.2, 8, f);
    for (const side of [-1, 1]) {
      const x = side * 2.5;
      props.stoneLantern(kit, { x, y: island.heightAt(x, z) - 0.05, z });
      c.block(x, z, 0.36);
    }
    avoid.push({ x: 0, z, r: 3.4 });
  }
  avoid.push({ x: 0, z: 16.2, r: 3.6 });

  props.shrine(kit, { x: 0, y: courtY, z: -3.7 });
  c.block(-1.1, -3.7, 1.9);
  c.block(1.1, -3.7, 1.9);

  // The five lanterns the memory game plays on, in a shallow arc facing the steps.
  const lanterns: GameLantern[] = [];
  const bodyGeometry = new THREE.SphereGeometry(0.62, 12, 9);
  bodyGeometry.scale(1, 1.18, 1);
  LANTERN_COLORS.forEach((hex, i) => {
    const phi = (i - 2) * 0.56;
    const x = Math.sin(phi) * 4.5;
    const z = 1.3 - Math.cos(phi) * 2.3;
    kit.solid
      .add(cyl(0.3, 0.36, 0.25, 6, '#6f6c7a'), { x, y: courtY + 0.12, z })
      .add(cyl(0.07, 0.09, 1.3, 6, '#2a2933'), { x, y: courtY + 0.85, z })
      .add(cyl(0.34, 0.26, 0.14, 8, '#2a2933'), { x, y: courtY + 1.5, z })
      .add(cyl(0.2, 0.36, 0.2, 8, '#2a2933'), { x, y: courtY + 2.98, z });
    const color = new THREE.Color(hex);
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(bodyGeometry, material);
    mesh.position.set(x, courtY + 2.24, z);
    group.add(mesh);
    c.block(x, z, 0.34);
    lanterns.push({ mesh, material, color });
  });
  c.built.lanterns = lanterns;

  const paper = new PaperLanterns(island.shape.radius * 0.8);
  group.add(paper.mesh);

  const tops = addIslets(c, [
    [0.2, 8, -5, 3.0],
    [3.5, 7, 4, 2.6],
    [5.0, 10, -11, 3.6],
  ]);
  plant(c, {
    round: { count: 34, colors: ['#f4b8cc', '#f7c6d6', '#ee9fbb', '#fbd9e3'], extra: tops, size: [0.9, 1.5] },
    pine: { count: 7, colors: ['#4f7a66', '#446d5c'] },
    grass: { count: 600, colors: ['#7fb37d', '#6ea774', '#93c08a'] },
    flowers: { count: 150, colors: ['#ffd6e4', '#ffffff', '#f7a8c4'] },
    rocks: { count: 22, colors: ['#8f879c', '#7a728a', '#a49cb0'] },
  });

  c.built.update = (_dt, time, day) => {
    paper.update(time, day.night);
    if (c.built.gameActive) return;
    // Idle glow: dim paper by day, softly lit and breathing at night.
    lanterns.forEach((lantern, i) => {
      const breath = 1 + Math.sin(time * 1.2 + i * 1.3) * 0.12 * day.night;
      lantern.material.color.copy(lantern.color).multiplyScalar(lerp(0.5, 1.5, day.night) * breath);
    });
  };
}

// ---------------------------------------------------------------- layouts

const LAYOUTS: readonly Layout[] = [
  {
    id: 'hub',
    position: [0, 0, 0],
    dockAngle: 0.3,
    view: { theta: 0.95, phi: 1.12, radius: 66 },
    lift: 3.5,
    labelHeight: 27,
    shape: {
      seed: 11,
      radius: 30,
      depth: 30,
      plateau: 2.4,
      hills: 1.3,
      lobes: 3,
      rings: 18,
      segments: 80,
      flats: [
        { x: -3, z: 2, r: 6.6, y: 2.5, color: '#d3c6a6' },
        { x: -14, z: -11, r: 3.0, y: 5.6 },
      ],
      bumps: [{ x: -14, z: -11, r: 7.5, h: 3.4 }],
      pits: [{ x: 11, z: -11, r: 4.4, depth: 1.7 }],
      palette: meadow,
    },
    dress: dressHub,
  },
  {
    id: 'ubin',
    position: [96, 14, -42],
    dockAngle: 2.3,
    view: { theta: -1.13, phi: 1.02, radius: 50 },
    lift: 3,
    labelHeight: 17,
    shape: {
      seed: 23,
      radius: 22,
      depth: 22,
      plateau: 2.0,
      hills: 0.8,
      lobes: 4,
      flats: [{ x: 0, z: 0, r: 9.4, y: 2.3, color: '#d8ccb0' }],
      palette: {
        grassA: '#a9b26a',
        grassB: '#8f9f52',
        sand: '#dfd0a8',
        soil: '#8a6f52',
        cliff: '#b9a585',
        rockA: '#8d796a',
        rockB: '#54485a',
      },
    },
    dress: dressUbin,
  },
  {
    id: 'rimba',
    position: [-90, 8, -62],
    dockAngle: 0.61,
    view: { theta: 0.5, phi: 1.1, radius: 56 },
    lift: 3.5,
    labelHeight: 19,
    shape: {
      seed: 37,
      radius: 26,
      depth: 28,
      plateau: 2.6,
      hills: 2.4,
      lobes: 3,
      rings: 17,
      flats: [{ x: -3, z: -12, r: 3.4, y: 2.9 }],
      bumps: [{ x: -9, z: 7, r: 6.5, h: 4.2 }],
      pits: [{ x: 7, z: -6, r: 5, depth: 1.9 }],
      palette: {
        grassA: '#3f8a5a',
        grassB: '#2f6f52',
        sand: '#7b6a4c',
        soil: '#5a4636',
        cliff: '#5d6470',
        rockA: '#59606e',
        rockB: '#343747',
      },
    },
    dress: dressRimba,
  },
  {
    id: 'angin',
    position: [-72, 26, 80],
    dockAngle: -0.84,
    view: { theta: 2.05, phi: 1.1, radius: 54 },
    lift: 5,
    labelHeight: 24,
    shape: {
      seed: 53,
      radius: 22,
      depth: 24,
      plateau: 2.0,
      hills: 1.5,
      lobes: 3,
      snowLine: 8.4,
      flats: [
        { x: 7, z: -3, r: 2.2, y: 2.5 },
        { x: 1, z: 9, r: 2.1, y: 2.5 },
        { x: -3, z: -11, r: 2.1, y: 2.4 },
      ],
      bumps: [{ x: -7, z: 3.5, r: 6.4, h: 10.5 }],
      palette: {
        grassA: '#c9c065',
        grassB: '#a9b25a',
        sand: '#d9c9a0',
        soil: '#8a6f4c',
        cliff: '#8d8a86',
        rockA: '#7d7a78',
        rockB: '#46465a',
        snow: '#f6f8fc',
      },
    },
    dress: dressAngin,
  },
  {
    id: 'lentera',
    position: [74, 34, 88],
    dockAngle: 0.77,
    view: { theta: 0.25, phi: 1.08, radius: 58 },
    lift: 5.5,
    labelHeight: 21,
    shape: {
      seed: 71,
      radius: 22,
      depth: 26,
      plateau: 1.8,
      hills: 0.8,
      lobes: 4,
      flats: [{ x: 0, z: 0, r: 6.5, y: 6.2, color: '#b5aec2' }],
      bumps: [{ x: 0, z: 0, r: 10.5, h: 5.6 }],
      palette: {
        grassA: '#7fae7a',
        grassB: '#5f9670',
        sand: '#b7a79a',
        soil: '#5d4a58',
        cliff: '#7a6f86',
        rockA: '#665a78',
        rockB: '#3b3350',
      },
    },
    dress: dressLentera,
  },
];

/** Feathers per island; the last one floats high enough that it takes a jump. */
const FEATHERS = 3;

/** Scatter the island's wind feathers on open ground, clear of everything solid and of the game spot. */
function placeFeathers(built: BuiltIsland, avoid: { x: number; z: number; r: number }[], rng: Rng): void {
  const g = built.group.position;
  const keepOut = [
    ...avoid,
    ...built.walk.blockers.map((b) => ({ x: b.x, z: b.z, r: b.r + 1 })),
    { x: built.walk.station.x - g.x, z: built.walk.station.z - g.z, r: 4 },
  ];
  const spots = built.island.scatter(rng, FEATHERS, { avoid: keepOut, margin: 0.14, spacing: 9, minFlatness: 0.75 });
  built.walk.feathers = spots.map((p, i) => new THREE.Vector3(p.x, p.y + (i === FEATHERS - 1 ? 2.3 : 1.05), p.z).add(g));
}

function buildIsland(layout: Layout, pixelRatio: number): BuiltIsland {
  const island = new Island(layout.shape);
  const group = new THREE.Group();
  group.position.set(...layout.position);
  group.add(island.mesh);

  const kit = props.newKit();
  const theta = layout.dockAngle;
  const rim = island.rimRadius(theta);
  const outward = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
  props.dock(kit, { x: outward.x * (rim - 1), z: outward.z * (rim - 1), ry: -theta });
  // Point along the pier in island space: `along` metres out from the pier's root, `across` to its side.
  const onPier = (along: number, across: number): { x: number; z: number } => ({
    x: outward.x * (rim - 1 + along) - outward.z * across,
    z: outward.z * (rim - 1 + along) + outward.x * across,
  });
  const deck = onPier(3, 0);
  // Land on the side of the pier clear of the crates, so walking straight ahead leads ashore.
  const landing = onPier(6.6, 0.75);

  const built: BuiltIsland = {
    id: layout.id,
    island,
    group,
    focus: group.position.clone().add(new THREE.Vector3(0, layout.lift, 0)),
    view: layout.view,
    dock: {
      // The keel hovers just above deck height, alongside the end of the pier.
      position: outward.clone().multiplyScalar(rim + 8.8).setY(0.61 + KEEL_DEPTH + 0.35).add(group.position),
      yaw: -theta,
      outward,
    },
    bounds: new THREE.Sphere(group.position.clone().add(new THREE.Vector3(0, 1, 0)), layout.shape.radius * 0.95),
    label: group.position.clone().add(new THREE.Vector3(0, layout.labelHeight, 0)),
    gameActive: false,
    obstacles: [],
    walk: {
      // Narrower than the planks so the railings stay outside the character.
      platforms: [{ x: deck.x, z: deck.z, ry: -theta, hx: 4.7, hz: 1.15, y: 0.61 }],
      blockers: [],
      stairs: [],
      feathers: [],
      pier: group.position.clone().add(new THREE.Vector3(landing.x, 0.61, landing.z)),
      station: group.position.clone(),
    },
  };
  // Crates and bollards on the pier (`across` matches the prop's local z).
  for (const [along, across, r] of [
    [5.4, -0.95, 0.45],
    [5.5, -0.1, 0.38],
    [7.1, 1.25, 0.24],
    [7.1, -1.25, 0.24],
  ] as const) {
    const p = onPier(along, across);
    built.walk.blockers.push({ x: p.x, z: p.z, r });
  }

  const avoid = [{ x: outward.x * (rim - 2), z: outward.z * (rim - 2), r: 4.6 }];
  layout.dress({
    built,
    island,
    group,
    kit,
    rng: mulberry32(layout.shape.seed * 101 + 7),
    avoid,
    pixelRatio,
    world: (x, y, z) => new THREE.Vector3(x, y, z).add(group.position),
    block: (x, z, r) => built.walk.blockers.push({ x, z, r }),
    station: (x, z, y = island.heightAt(x, z)) => {
      built.walk.station = new THREE.Vector3(x, y, z).add(group.position);
      avoid.push({ x, z, r: 2.4 }); // keep trees and rocks off the glowing spot
    },
  });

  placeFeathers(built, avoid, mulberry32(layout.shape.seed * 313 + 5));

  group.add(kit.solid.mesh(solidMat));
  if (!kit.window.empty) group.add(new THREE.Mesh(kit.window.geometry(), windowGlow));
  if (!kit.lamp.empty) group.add(new THREE.Mesh(kit.lamp.geometry(), lampGlow));
  if (!kit.spore.empty) group.add(new THREE.Mesh(kit.spore.geometry(), sporeGlow));
  return built;
}

export function buildIslands(pixelRatio: number): Map<IslandId, BuiltIsland> {
  return new Map(LAYOUTS.map((layout) => [layout.id, buildIsland(layout, pixelRatio)]));
}
