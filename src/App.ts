import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ISLANDS, OUTFITS, islandInfo, outfitUnlocked, unlockText, type IslandId, type Progress } from './content';
import { AudioEngine } from './core/AudioEngine';
import { CameraRig, type RigLimits } from './core/CameraRig';
import { PHASES, clockLabel, phaseLabel } from './core/DayNight';
import { Input, type PointerInfo } from './core/Input';
import { clamp, damp, shortestAngle } from './core/math';
import { DEFAULT_OUTFIT, Store, type GameId } from './core/Store';
import { createGame, prefetchGame, type GameOutcome, type MiniGame } from './games';
import { PerfStats } from './ui/PerfStats';
import { UI, recordText, type Mode, type Prompt } from './ui/UI';
import type { BuiltIsland } from './world/islands';
import { Flight, resolveCollisions, type FlightInput } from './world/Flight';
import { NPC_RADIUS, type Npc } from './world/Npc';
import { BODY_RADIUS, Walker, groundAt, type WalkInput } from './world/Walk';
import { WEATHER_KINDS, WEATHER_LABEL, isWeatherKind, type WeatherKind } from './world/Weather';
import { World } from './world/World';
import { foliageMat, solidMat } from './world/materials';

const MAP_TARGET = new THREE.Vector3(0, 14, 14);
const MAP_LIMITS: RigLimits = { minPhi: 0.35, maxPhi: 1.36, minRadius: 150, maxRadius: 540 };
// Capped so the orbit can never swing through a neighbouring island.
const ISLAND_LIMITS: RigLimits = { minPhi: 0.3, maxPhi: 1.5, minRadius: 24, maxRadius: 82 };
const TRAVEL_LIMITS: RigLimits = { minPhi: 0.5, maxPhi: 1.5, minRadius: 26, maxRadius: 90 };
// Free flight lets the camera dip a little below the ship to look up at the islands.
const FLY_LIMITS: RigLimits = { minPhi: 0.3, maxPhi: 1.75, minRadius: 16, maxRadius: 72 };
// On foot the camera sits close behind the character and may dip low enough to look up at things.
const WALK_LIMITS: RigLimits = { minPhi: 0.45, maxPhi: 1.62, minRadius: 5, maxRadius: 24 };
const WALK_VIEW = { phi: 1.2, radius: 11 };
/** The camera needs far less room than the ship to stay out of the rock. */
const CAMERA_HULL = { side: 1.5, above: 2.5, below: 1.5 };
/** Walking, the camera only has to stay above the grass. */
const WALK_CAMERA_HULL = { side: 0.5, above: 0.9, below: 1 };
/** How close the character must be to the glowing spot, or to the end of the pier, to use it. */
const STATION_RANGE = 2.4;
const BOARD_RANGE = 2.6;
/** Close enough to an islander to start a conversation. */
const TALK_RANGE = 2.2;
/** How far apart two people stand while talking. */
const TALK_DISTANCE = 1.7;
/** The guide chip only appears when the game spot is further than this and off screen. */
const GUIDE_DISTANCE = 7;
/** Farthest the character will jump to reach the gondola; beyond this it vanishes instead. */
const LEAP_REACH = 7;
/** Rises smaller than this (a stair tread, a kerb) are eased rather than snapped. */
const STEP_SMOOTHING = 0.8;
/** Height of the gondola floor above the ship's origin. */
const GONDOLA_FLOOR = -3.25;
/** The airship as one ellipsoid for sight-line tests: centre offset and semi-axes, in its own frame. */
const SHIP_OFFSET = new THREE.Vector3(0, 1.2, 0);
const SHIP_EXTENT = new THREE.Vector3(2.8, 4.2, 6.1);
const FIREWORK_COLORS = ['#ffd76a', '#ff8f6b', '#8ff3dc', '#c79bff', '#ff7aa8', '#9fd0ff'];
const UP = new THREE.Vector3(0, 1, 0);

const isIslandId = (value: string | null): value is IslandId => ISLANDS.some((island) => island.id === value);

/** Wires input, camera, world, audio and UI together and owns the flow between modes. */
export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4200);
  private readonly rig = new CameraRig(this.camera);
  private readonly raycaster = new THREE.Raycaster();
  private readonly audio = new AudioEngine();
  private readonly store = new Store();
  private readonly input: Input;
  private readonly world: World;
  private readonly flight: Flight;
  private readonly walker = new Walker();
  /** Where the character is drawn, which trails the walker slightly when stepping up. */
  private readonly heroShown = new THREE.Vector3();
  private readonly ui: UI;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private mode: Mode = 'title';
  private current: IslandId = 'hub';
  /** True while the ship is tied up at `current`; false once it is out in open sky. */
  private docked = true;
  /** Where closing the map should take the player back to. */
  private mapReturn: 'fly' | 'island' = 'fly';
  private placeShown: IslandId | null = null;
  /** True while the character is jumping between the pier and the gondola. */
  private boarding = false;
  private atStation = false;
  private atPier = false;
  private liftHeld = false;
  private stepClock = 0;
  /** The islander within talking range, if any. */
  private nearNpc: Npc | null = null;
  /** The conversation on screen: who, what they say, and which line is showing. */
  private talk: { npc: Npc; lines: string[]; index: number } | null = null;
  /** Control schemes the player has already been shown, so later reminders can be brief. */
  private readonly schemesSeen = new Set<'fly' | 'walk'>();
  private game: MiniGame | null = null;
  /** Counts game launches, so a game that finishes downloading too late can tell it is stale. */
  private launches = 0;
  private gameOver = false;
  private trip: { started: number; duration: number } | null = null;
  private pixelRatio: number;
  private last = 0;
  private slowFrames = 0;
  private sampledFrames = 0;
  private sampledTime = 0;

  /** How far the picture is slid across the screen to make room for UI, as a fraction of its size. */
  private readonly framing = { x: 0, y: 0 };
  private readonly scratch = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  /** Per island: tree crowns and buildings the walking camera must not hide behind. */
  private readonly occluders = new Map<IslandId, THREE.Object3D[]>();
  /** How far the walking camera may currently sit from the character before something blocks the view. */
  private viewReach = Infinity;
  /** Point between the player and an islander, which the camera orbits during a conversation. */
  private readonly talkFocus = new THREE.Object3D();
  /** Frame-rate readout, only with `?stats`. */
  private stats: PerfStats | null = null;
  /** Seconds before another flutter of birds may be heard. */
  private flutterCooldown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.ui = new UI({
      start: () => this.start(),
      openMap: () => this.openMap(),
      fly: () => this.board(),
      act: () => this.act(),
      travel: (id) => this.travelTo(id),
      play: () => this.play(),
      exitGame: () => this.exitGame(),
      replay: () => this.replay(),
      cycleTime: () => this.cycleTime(),
      cycleWeather: () => this.cycleWeather(),
      toggleSound: () => this.toggleSound(),
      reset: () => this.reset(),
      celebrate: () => this.requestCelebration(),
      hover: (id) => this.ui.highlightPin(id),
      talkNext: () => this.talkNext(),
      wear: (id) => this.wear(id),
    });

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);

    // Throws when WebGL is unavailable; main.ts turns that into a readable message.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.world = new World(this.pixelRatio, coarse ? 1400 : 2400);
    this.flight = new Flight(this.world.ship, this.world.islands);
    for (const built of this.world.islands.values()) {
      const list: THREE.Object3D[] = [];
      for (const child of built.group.children) {
        if (child instanceof THREE.Mesh && (child.material === foliageMat || child.material === solidMat)) list.push(child);
      }
      this.occluders.set(built.id, list);
    }

    // HDR target with MSAA: lights can exceed 1.0 and the bloom pass turns the excess into glow.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.world.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.65, 1.3));
    this.composer.addPass(new OutputPass());

    this.input = new Input(canvas);
    this.input.onDrag(({ dx, dy }) => this.rig.drag(dx, dy));
    this.input.onZoom((delta) => this.rig.zoom(delta));
    this.input.onTap((pointer) => this.onTap(pointer));
    this.input.onKey((key) => this.onKey(key));

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend();
      else this.audio.resume();
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.ui.toast('Tampilan 3D terputus. Muat ulang halaman buat melanjutkan.');
    });

    if (new URLSearchParams(location.search).has('stats')) this.stats = new PerfStats(this.renderer);
    this.applyQuery();
    this.resize();
    this.rig.snap({ target: this.world.island('hub').focus, theta: 1.3, phi: 1.24, radius: 80 });
    this.rig.autoRotate = this.reducedMotion ? 0 : 0.04;
    this.rig.limits = { minPhi: 0.5, maxPhi: 1.45, minRadius: 50, maxRadius: 82 };
    this.setFraming('title', 0);

    this.world.feathers.restore(this.store.feathers);
    this.wear(this.store.outfit, false);
    this.syncProgress();
    this.ui.setSound(this.store.muted);
    this.ui.setMode('title');
  }

  /** Render the first frame, then unlock the start button. */
  run(): void {
    this.last = performance.now();
    this.renderer.compile(this.world.scene, this.camera);
    requestAnimationFrame(this.frame);
    requestAnimationFrame(() => {
      this.ui.ready();
      if (new URLSearchParams(location.search).has('autostart')) this.start();
    });
  }

  // ------------------------------------------------------------ flow

  private start(): void {
    if (this.mode !== 'title') return;
    this.audio.start();
    this.audio.setMuted(this.store.muted);
    this.audio.chime(3);
    if (this.current === 'hub') this.takeOff(true);
    else this.enterIsland(this.current);
  }

  private openMap(): void {
    if (this.mode !== 'island' && this.mode !== 'fly') return;
    this.endTalk();
    this.ui.setGuide(null);
    this.mapReturn = this.mode;
    this.ui.setPrompt(null);
    this.mode = 'map';
    this.ui.setMode('map');
    this.setFraming('map');
    this.ui.setPlace(islandInfo(this.current));
    this.rig.follow = null;
    this.rig.autoRotate = this.reducedMotion ? 0 : 0.012;
    void this.rig.flyTo({ target: MAP_TARGET, phi: 0.98, radius: this.portrait ? 470 : 330 }, 2.2, MAP_LIMITS);
  }

  private closeMap(): void {
    if (this.mode !== 'map') return;
    this.ui.highlightPin(null);
    delete document.body.dataset.hover;
    if (this.mapReturn === 'island' && this.docked) this.resumeWalk();
    else this.resumeFlight();
  }

  // ------------------------------------------------------------ free flight

  /** Cast off from the pier (or from the title screen) and hand the controls to the player. */
  private takeOff(fromTitle = false): void {
    if (!fromTitle && this.mode !== 'island') return;
    this.docked = false;
    this.flight.begin(true);
    this.resumeFlight();
    this.audio.whoosh(1.6);
    this.flashControls('fly');
    if (fromTitle) this.ui.toast('Dekati pulau mana pun, lalu tekan E buat singgah.');
  }

  /** Show a control scheme's keys: longer the first time, briefly after that. */
  private flashControls(scheme: 'fly' | 'walk'): void {
    this.ui.flashControls(scheme, this.schemesSeen.has(scheme) ? 3.5 : 7);
    this.schemesSeen.add(scheme);
  }

  /** Switch the screen and camera into flying, without touching the ship's motion. */
  private resumeFlight(): void {
    this.mode = 'fly';
    this.ui.setMode('fly');
    this.setFraming('fly');
    this.placeShown = null;
    // A focused ticket button would swallow Space, which is the climb key.
    (document.activeElement as HTMLElement | null)?.blur();
    this.rig.follow = this.world.ship.root;
    this.rig.autoRotate = 0;
    void this.rig.flyTo({ theta: this.flight.yaw + Math.PI, phi: 1.34, radius: 30 }, 1.4, FLY_LIMITS);
  }

  /** The E key: call at a nearby island from the air, or use whatever the character stands next to. */
  private act(): void {
    if (this.mode === 'fly') {
      const near = this.flight.nearby();
      if (near) this.dockAt(near.id);
      return;
    }
    if (this.mode !== 'island' || this.boarding) return;
    if (this.talk) this.talkNext();
    else if (this.atStation) this.play();
    else if (this.nearNpc) this.startTalk(this.nearNpc);
    else if (this.atPier) this.board();
  }

  // ------------------------------------------------------------ islanders

  private progress(): Progress {
    return {
      stamps: this.store.stamps,
      feathers: this.store.feathers.length,
      featherTotal: this.world.feathers.total,
      record: (id) => recordText(id, this.store.records),
    };
  }

  private startTalk(npc: Npc): void {
    this.talk = { npc, lines: npc.info.lines(this.progress()), index: -1 };
    npc.talking = true;
    this.ui.setPrompt(null);
    this.ui.setGuide(null);

    // Step back to a comfortable distance (when there is ground there), then face each other.
    let dx = npc.position.x - this.walker.position.x;
    let dz = npc.position.z - this.walker.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap > 1e-3 && gap < TALK_DISTANCE) {
      const built = this.world.island(this.current);
      const g = built.group.position;
      const x = npc.position.x - (dx / gap) * TALK_DISTANCE;
      const z = npc.position.z - (dz / gap) * TALK_DISTANCE;
      const ground = groundAt(World.walkArea(built), x - g.x, z - g.z);
      if (ground !== null && Math.abs(ground + g.y - this.walker.position.y) < 0.5) {
        this.walker.position.set(x, ground + g.y, z);
        dx = npc.position.x - x;
        dz = npc.position.z - z;
      }
    }
    // Swing the camera side-on so both faces are in the shot.
    this.walker.yaw = Math.atan2(dx, dz);
    this.world.hero.place(this.walker.position, this.walker.yaw);
    // Of the two side-on angles, take the one with the fewest trees and walls where the camera would sit.
    const side = Math.atan2(dz, -dx);
    const radius = 7.5;
    const phi = 1.28;
    const crowding = (theta: number): number => {
      const built = this.world.island(this.current);
      const g = built.group.position;
      const reach = Math.sin(phi) * radius;
      let score = 0;
      for (const f of [0.45, 0.75, 1]) {
        const cx = this.walker.position.x + dx / 2 + Math.sin(theta) * reach * f - g.x;
        const cz = this.walker.position.z + dz / 2 + Math.cos(theta) * reach * f - g.z;
        for (const b of built.walk.blockers) if (Math.hypot(cx - b.x, cz - b.z) < b.r + 2.2) score += f;
      }
      return score;
    };
    const facing = Math.abs(shortestAngle(this.rig.goal.theta, side)) < Math.PI / 2 ? side : side + Math.PI;
    const other = facing + Math.PI;
    const theta = crowding(other) < crowding(facing) ? other : facing;
    // Frame the pair rather than just the player: orbit the point between them.
    this.talkFocus.position.set(this.walker.position.x + dx / 2, this.walker.position.y + 1.05, this.walker.position.z + dz / 2);
    this.rig.follow = this.talkFocus;
    void this.rig.flyTo({ theta, phi, radius }, 0.9, WALK_LIMITS);
    this.talkNext();
  }

  private talkNext(): void {
    const talk = this.talk;
    if (!talk) return;
    talk.index++;
    const line = talk.lines[talk.index];
    if (line === undefined) {
      this.endTalk();
      return;
    }
    this.audio.click();
    const { info } = talk.npc;
    this.ui.showTalk(info.name, info.role, line, talk.index === talk.lines.length - 1);
  }

  private endTalk(): void {
    if (!this.talk) return;
    this.talk.npc.talking = false;
    this.talk = null;
    this.ui.hideTalk();
    if (this.rig.follow === this.talkFocus) this.rig.follow = this.world.hero.anchor;
  }

  // ------------------------------------------------------------ feathers and costumes

  /** Put on a costume, if it has been earned. */
  private wear(id: string, announce = true): void {
    const outfit = OUTFITS.find((o) => o.id === id && this.unlocked(o)) ?? OUTFITS.find((o) => o.id === DEFAULT_OUTFIT);
    if (!outfit) return;
    this.world.hero.wear(outfit);
    if (this.store.outfit !== outfit.id) this.store.outfit = outfit.id;
    if (announce) {
      this.audio.click();
      this.renderExtras();
    }
  }

  private unlocked(outfit: (typeof OUTFITS)[number]): boolean {
    return outfitUnlocked(outfit, this.store.stamps.length, this.store.feathers.length, this.world.feathers.total);
  }

  private renderExtras(): void {
    const choices = OUTFITS.map((o) => ({ ...o, unlocked: this.unlocked(o), hint: unlockText(o) }));
    this.ui.renderExtras(this.store.feathers.length, this.world.feathers.total, choices, this.store.outfit);
  }

  /** Tell the player about costumes that the last stamp or feather has just unlocked. */
  private announceUnlocks(before: Set<string>): void {
    for (const outfit of OUTFITS) {
      if (before.has(outfit.id) || !this.unlocked(outfit)) continue;
      this.ui.toast(`Kostum baru: ${outfit.name}. Ganti kostum lewat buku cap.`);
    }
  }

  private unlockedIds(): Set<string> {
    return new Set(OUTFITS.filter((o) => this.unlocked(o)).map((o) => o.id));
  }

  private pickUpFeathers(): void {
    const id = this.world.feathers.collect(this.walker.position);
    if (!id) return;
    const before = this.unlockedIds();
    if (!this.store.addFeather(id)) return;
    const count = this.store.feathers.length;
    const total = this.world.feathers.total;
    this.audio.chime(Math.min(8, 3 + (count % 6)));
    this.ui.toast(count === total ? `Semua ${total} bulu angin terkumpul!` : `Bulu angin ${count}/${total}`);
    this.announceUnlocks(before);
    this.renderExtras();
  }

  /** Short scripted approach from wherever the ship is to the island's pier. */
  private dockAt(id: IslandId): void {
    const to = this.world.island(id);
    const ship = this.world.ship;
    const a = ship.root.position.clone();
    const b = to.dock.position.clone();
    const heading = b.clone().sub(a).setY(0);
    if (heading.lengthSq() < 1e-6) heading.copy(to.dock.outward).negate();
    heading.normalize();
    const along = new THREE.Vector3(-to.dock.outward.z, 0, to.dock.outward.x);
    if (along.dot(heading) < 0) along.negate();
    const approach = b.clone().addScaledVector(to.dock.outward, 12).addScaledVector(along, -13).addScaledVector(UP, 6);

    // If the straight line to the approach crosses the island, climb over it first.
    const center = to.group.position;
    const points = [a];
    const crossing = this.segmentPassesOver(a, approach, center, to.island.shape.radius + 6);
    if (crossing) {
      const safe = Math.max(a.y, center.y + 28);
      points.push(a.clone().lerp(approach, 0.15).setY(safe), approach.clone().lerp(a, 0.15).setY(safe));
    }
    if (a.distanceTo(approach) > 6) points.push(approach);
    points.push(b);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const duration = clamp(curve.getLength() / 14, 2.5, 7);

    this.mode = 'travel';
    this.trip = { started: performance.now(), duration };
    this.ui.setMode('travel');
    this.ui.setPrompt(null);
    this.ui.showDocking(islandInfo(id));
    this.audio.click();
    void ship.flyAlong(curve, duration).then(() => {
      ship.turnTo(Math.atan2(along.x, along.z));
      this.trip = null;
      this.audio.chime(2);
      this.enterIsland(id);
    });
  }

  /** Does the horizontal segment a→b come within `radius` of `center`? */
  private segmentPassesOver(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? clamp(((center.x - a.x) * dx + (center.z - a.z) * dz) / lengthSq, 0, 1) : 0;
    return Math.hypot(a.x + dx * t - center.x, a.z + dz * t - center.z) < radius;
  }

  private controls(): FlightInput {
    const keys = this.input.keys;
    const held = (...names: string[]): number => (names.some((name) => keys.has(name)) ? 1 : 0);
    const touch = this.ui.touch;
    return {
      throttle: clamp(held('w', 'ArrowUp') - held('s', 'ArrowDown') + touch.y, -1, 1),
      turn: clamp(held('d', 'ArrowRight') - held('a', 'ArrowLeft') + touch.x, -1, 1),
      lift: clamp(held(' ') - held('Shift') + touch.lift, -1, 1),
    };
  }

  private updateFlight(dt: number): void {
    this.flight.update(dt, this.controls());

    // Swing the camera round behind the ship, unless the player is looking around.
    if (this.rig.enabled && this.rig.idleTime > 1.2) {
      const follow = clamp(this.flight.pace * 1.5, 0.25, 1);
      const behind = this.flight.yaw + Math.PI;
      this.rig.goal.theta += shortestAngle(this.rig.goal.theta, behind) * (1 - Math.exp(-2.2 * dt)) * follow;
    }

    const near = this.flight.nearby();
    this.ui.setPrompt(near ? this.offer(near.id, 'Singgah di') : null);
    const closest = this.flight.closest().id;
    if (closest !== this.placeShown) {
      this.placeShown = closest;
      this.ui.setPlace(islandInfo(closest));
    }
  }

  private offer(id: IslandId, lead: string): Prompt {
    const info = islandInfo(id);
    return { code: info.code, lead, name: info.name };
  }

  /** Arrive at an island: the character hops off the gondola onto the pier and the player walks from there. */
  private enterIsland(id: IslandId): void {
    const built = this.world.island(id);
    const hero = this.world.hero;
    this.current = id;
    this.docked = true;
    this.syncProgress();

    // Face up the pier, towards the island.
    const yaw = Math.atan2(-built.dock.outward.x, -built.dock.outward.z);
    const from = this.world.ship.root.position.clone().add(new THREE.Vector3(0, GONDOLA_FLOOR, 0));
    this.walker.enter(World.walkArea(built), built.group.position, built.walk.pier, yaw);
    hero.place(from, yaw);
    hero.visible = true;
    this.boarding = true;
    void hero.leap(from, this.walker.position.clone(), 1.1, 0.55).then(() => {
      this.boarding = false;
      hero.place(this.walker.position, yaw);
      hero.impact(0.55);
      this.audio.land();
    });

    this.resumeWalk(yaw + Math.PI);
    if (!this.schemesSeen.has('walk')) {
      this.ui.toast('Jalan ke cahaya keemasan buat main. Balik ke ujung dermaga buat naik kapal lagi.');
    }
    this.flashControls('walk');
    if (id === 'hub' && this.store.complete && !this.store.celebrated) this.celebrate();
  }

  /** Hand the controls back to the character where it stands, with the camera behind it. */
  private resumeWalk(theta = this.walker.yaw + Math.PI, phi = WALK_VIEW.phi): void {
    this.mode = 'island';
    this.ui.setMode('island');
    this.ui.setPrompt(null);
    this.atStation = false;
    this.atPier = false;
    this.setFraming('island');
    // A focused button would swallow Space, which is the jump key.
    (document.activeElement as HTMLElement | null)?.blur();
    this.rig.follow = this.world.hero.anchor;
    this.rig.autoRotate = 0;
    void this.rig.flyTo({ theta, phi, radius: WALK_VIEW.radius }, 1.6, WALK_LIMITS);
  }

  /** Jump back into the gondola and cast off. */
  private board(): void {
    if (this.mode !== 'island' || this.boarding) return;
    this.endTalk();
    this.ui.setGuide(null);
    const hero = this.world.hero;
    const to = this.world.ship.root.position.clone().add(new THREE.Vector3(0, GONDOLA_FLOOR, 0));
    this.boarding = true;
    this.ui.setPrompt(null);
    this.ui.setTicket(false);
    // From the pier it is a short hop. From further away (the Esc shortcut) a leap would cross half
    // the island, so the character spins away instead and turns up aboard.
    const near = this.walker.distanceTo(to) <= LEAP_REACH;
    if (near) this.audio.hop();
    else this.audio.chime(6);
    const move = near ? hero.leap(this.walker.position.clone(), to, 1.3, 0.5) : hero.vanish();
    void move.then(() => {
      hero.visible = false;
      this.boarding = false;
      this.takeOff();
    });
  }

  private walkInput(): WalkInput {
    const keys = this.input.keys;
    const held = (...names: string[]): number => (names.some((name) => keys.has(name)) ? 1 : 0);
    const touch = this.ui.touch;
    const forward = clamp(held('w', 'ArrowUp') - held('s', 'ArrowDown') + touch.y, -1, 1);
    const strafe = clamp(held('d', 'ArrowRight') - held('a', 'ArrowLeft') + touch.x, -1, 1);
    // Directions are relative to where the camera looks, flattened onto the ground.
    const look = this.scratch.copy(this.rig.target).sub(this.camera.position).setY(0);
    if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
    look.normalize();
    let x = look.x * forward - look.z * strafe;
    let z = look.z * forward + look.x * strafe;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    return { x, z, run: keys.has('Shift') };
  }

  private updateWalk(dt: number): void {
    const hero = this.world.hero;
    const built = this.world.island(this.current);

    if (!this.boarding) {
      // A conversation holds the character still; walking off is not an option mid-sentence.
      const input = this.talk ? { x: 0, z: 0, run: false } : this.walkInput();
      const moving = Math.hypot(input.x, input.z) > 0.05;
      // Any step ends a cinematic shot (such as the fireworks) and brings the camera back.
      if (moving && this.rig.follow !== hero.anchor) this.resumeWalk(this.rig.goal.theta);

      const lift = this.ui.touch.lift > 0;
      if (lift && !this.liftHeld && !this.talk) this.walker.jump();
      this.liftHeld = lift;

      const { jumped, landed } = this.walker.update(dt, input);
      this.keepClearOfIslanders();
      const feet = this.walker.position;
      if (jumped) {
        this.audio.hop();
        hero.impact(-0.45);
        this.world.dust.burst(feet, 5, 0.8);
      }
      if (landed) {
        this.audio.land();
        hero.impact(0.6);
        this.world.dust.burst(feet, 9, 1.3);
      }
      this.pickUpFeathers();
      // Ease up onto each stair tread or ledge instead of popping up a whole step in one frame.
      const shown = this.heroShown.copy(this.walker.position);
      const rise = shown.y - hero.root.position.y;
      if (this.walker.grounded && rise > 0 && rise < STEP_SMOOTHING) shown.y = damp(hero.root.position.y, shown.y, 24, dt);
      hero.place(shown, this.walker.yaw);

      if (this.walker.grounded && this.walker.speed > 0.6) {
        this.stepClock += dt * this.walker.speed * 0.36;
        if (this.stepClock > 1) {
          this.stepClock -= 1;
          this.audio.step();
          // Only a proper run kicks up dust; strolling stays tidy.
          if (this.walker.speed > 6) this.world.dust.burst(feet, 2, 0.6);
        }
      }

      // Drift the camera round behind the character while it heads somewhere.
      if (moving && this.rig.enabled && this.rig.idleTime > 1.2 && this.rig.follow === hero.anchor) {
        const behind = this.walker.yaw + Math.PI;
        this.rig.goal.theta += shortestAngle(this.rig.goal.theta, behind) * (1 - Math.exp(-0.9 * dt));
      }
    }
    hero.update(dt, this.world.elapsed, this.boarding ? 0 : this.walker.speed, this.boarding || !this.walker.grounded);

    const station = built.walk.station;
    const atStation =
      !this.boarding && this.walker.distanceTo(station) < STATION_RANGE && Math.abs(this.walker.position.y - station.y) < 2;
    this.atPier = !this.boarding && this.walker.distanceTo(built.walk.pier) < BOARD_RANGE;
    this.world.beacon(this.current).near = atStation;
    if (atStation !== this.atStation) {
      this.atStation = atStation;
      this.ui.setTicket(atStation);
      if (atStation) {
        this.audio.chime(4);
        // Fetch the game's code while the player reads the ticket.
        if (this.current !== 'hub') prefetchGame(this.current);
      }
    }
    this.nearNpc = null;
    if (!this.boarding && !this.atStation) {
      let best = TALK_RANGE;
      for (const npc of this.world.npcsOn(this.current)) {
        const distance = this.walker.distanceTo(npc.position);
        if (distance < best) {
          best = distance;
          this.nearNpc = npc;
        }
      }
    }
    // Walking away mid-conversation (only possible by being pushed) ends it quietly.
    if (this.talk && this.walker.distanceTo(this.talk.npc.position) > TALK_RANGE + 1.5) this.endTalk();

    const info = islandInfo(this.current);
    if (this.talk) this.ui.setPrompt(null);
    else if (this.nearNpc) this.ui.setPrompt({ code: info.code, lead: 'Ngobrol dengan', name: this.nearNpc.info.name });
    else this.ui.setPrompt(this.atPier ? { code: info.code, lead: 'Naik', name: 'kapal udara' } : null);
    this.updateGuide(built);
  }

  /** Islanders are solid: shove the player round them rather than through them. */
  private keepClearOfIslanders(): void {
    const p = this.walker.position;
    for (const npc of this.world.npcsOn(this.current)) {
      const dx = p.x - npc.position.x;
      const dz = p.z - npc.position.z;
      const reach = NPC_RADIUS + BODY_RADIUS;
      const d = Math.hypot(dx, dz);
      if (d >= reach || Math.abs(p.y - npc.position.y) > 1.2) continue;
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      p.x = npc.position.x + nx * reach;
      p.z = npc.position.z + nz * reach;
    }
  }

  /**
   * Third-person camera rule: if a tree crown or a building stands between the character and the
   * camera, bring the camera in front of it instead of looking at the back of a wall of leaves.
   */
  private keepCharacterInView(dt: number): void {
    const anchor = (this.rig.follow ?? this.world.hero.anchor).position;
    const toCamera = this.scratch.copy(this.camera.position).sub(anchor);
    const distance = toCamera.length();
    if (distance < 1e-3) return;
    toCamera.divideScalar(distance);
    this.raycaster.set(anchor, toCamera);
    this.raycaster.far = distance;
    const hit = this.raycaster.intersectObjects(this.occluders.get(this.current) ?? [], false)[0];
    this.raycaster.far = Infinity;
    // Snap in at once (never show the inside of a tree), ease back out once the view clears.
    const wanted = hit ? Math.max(1.6, hit.distance - 0.4) : distance;
    this.viewReach = wanted < this.viewReach ? wanted : damp(this.viewReach, wanted, 2.5, dt);
    if (this.viewReach >= distance - 0.01) return;
    this.camera.position.copy(anchor).addScaledVector(toCamera, this.viewReach);
    this.camera.lookAt(anchor);
  }

  /** Point the way to the game spot when it is far away and out of view. */
  private updateGuide(built: BuiltIsland): void {
    const target = built.walk.station;
    const distance = this.walker.distanceTo(target);
    if (this.boarding || this.talk || this.atStation || distance < GUIDE_DISTANCE) {
      this.ui.setGuide(null);
      return;
    }
    const p = this.scratch.copy(target);
    p.y += 1.5;
    p.project(this.camera);
    const behind = p.z > 1;
    if (!behind && Math.abs(p.x) < 0.84 && Math.abs(p.y) < 0.78) {
      this.ui.setGuide(null);
      return;
    }
    // Behind the camera the projection flips, so mirror it back.
    let x = behind ? -p.x : p.x;
    let y = behind ? -p.y : p.y;
    if (Math.hypot(x, y) < 1e-3) y = -1;
    // Slide the chip out to the edge of a safe box, clear of the top bar and the bottom controls.
    const k = 1 / Math.max(Math.abs(x) / 0.82, Math.abs(y) / 0.7);
    x *= k;
    y *= k;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const info = islandInfo(this.current);
    this.ui.setGuide({
      x: (x * 0.5 + 0.5) * width,
      y: (-y * 0.5 + 0.5) * height,
      angle: Math.atan2(-y, x),
      label: `${info.game?.title ?? 'Buku cap'} · ${Math.round(distance)} m`,
    });
  }

  /** Islanders on the player's island stroll about; everyone else just breathes. */
  private updateIslanders(dt: number): void {
    const onFoot = this.mode === 'island' && this.world.hero.visible;
    for (const npc of this.world.npcs) {
      const here = npc.info.island === this.current;
      const active = here && (this.mode === 'island' || this.mode === 'map');
      npc.update(dt, this.world.elapsed, onFoot && here ? this.walker.position : null, active);
    }
  }

  private travelTo(id: IslandId): void {
    if (this.mode !== 'map' && this.mode !== 'island' && this.mode !== 'fly') return;
    this.endTalk();
    this.ui.setGuide(null);
    if (id === this.current && this.docked) {
      this.enterIsland(id);
      return;
    }
    // From open sky the trip starts wherever the ship happens to be.
    const from = this.docked ? this.world.island(this.current) : null;
    const to = this.world.island(id);
    const ship = this.world.ship;
    const { curve, yaw, heading } = this.planRoute(from, to);
    const duration = clamp(curve.getLength() / 17, 7, 12);

    this.mode = 'travel';
    this.trip = { started: performance.now(), duration };
    this.ui.setMode('travel');
    this.setFraming('travel');
    this.ui.showTravel(islandInfo(from?.id ?? this.flight.closest().id), islandInfo(id));
    this.ui.setPrompt(null);
    this.docked = false;
    // The character is already aboard by the time the ship pulls away.
    this.world.hero.visible = false;
    this.ui.highlightPin(null);
    delete document.body.dataset.hover;
    this.audio.click();
    this.audio.whoosh(2.6);

    // Ride alongside the ship, slightly behind it.
    this.rig.follow = ship.root;
    this.rig.autoRotate = 0;
    void this.rig.flyTo({ theta: Math.atan2(-heading.x, -heading.z) + 0.95, phi: 1.22, radius: 46 }, 2.4, TRAVEL_LIMITS);

    void ship.flyAlong(curve, duration).then(() => {
      ship.turnTo(yaw);
      this.trip = null;
      this.audio.chime(2);
      this.enterIsland(id);
    });
  }

  /** A swooping path from the ship's mooring to another island's dock. */
  private planRoute(from: BuiltIsland | null, to: BuiltIsland): { curve: THREE.CatmullRomCurve3; yaw: number; heading: THREE.Vector3 } {
    const ship = this.world.ship;
    const a = ship.root.position.clone();
    const b = to.dock.position.clone();
    const heading = b.clone().sub(a);
    const distance = heading.length();
    heading.setY(0).normalize();

    // Moor facing whichever way along the pier avoids a U-turn on arrival.
    const along = new THREE.Vector3(-to.dock.outward.z, 0, to.dock.outward.x);
    if (along.dot(heading) < 0) along.negate();
    const bow = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.root.quaternion).setY(0).normalize();

    const leave = a.clone().addScaledVector(bow, 9).addScaledVector(UP, 5);
    if (from) leave.addScaledVector(from.dock.outward, 10);
    const crest = a.clone().lerp(b, 0.5);
    crest.y = Math.max(a.y, b.y) + 16 + distance * 0.07;
    // Bow the route away from the middle of the archipelago so it arcs round rather than over.
    const outward = crest.clone().setY(0);
    if (outward.lengthSq() < 1) outward.set(heading.z, 0, -heading.x);
    crest.addScaledVector(outward.normalize(), distance * 0.14);
    const approach = b.clone().addScaledVector(to.dock.outward, 12).addScaledVector(along, -13).addScaledVector(UP, 6);

    return {
      curve: new THREE.CatmullRomCurve3([a, leave, crest, approach, b], false, 'centripetal'),
      yaw: Math.atan2(along.x, along.z),
      heading,
    };
  }

  private play(): void {
    if (this.mode !== 'island') return;
    const info = islandInfo(this.current);
    if (this.current === 'hub' || !info.game) {
      this.ui.openStamps();
      return;
    }
    this.endTalk();
    this.ui.setGuide(null);
    this.mode = 'game';
    this.ui.setMode('game');
    this.ui.setPrompt(null);
    this.setFraming('game');
    this.rig.follow = null;
    this.rig.autoRotate = 0;
    this.world.beacon(this.current).near = false;
    // Step out of shot; the games frame the island themselves.
    this.world.hero.visible = false;
    this.audio.click();
    this.launchGame(this.current);
  }

  private launchGame(id: GameId): void {
    this.gameOver = false;
    this.world.island(id).gameActive = true;
    this.ui.openGame(islandInfo(id));
    // The game's code may still be downloading; if the player leaves meanwhile, drop it.
    const launch = ++this.launches;
    void createGame(id, {
      world: this.world,
      built: this.world.island(id),
      camera: this.camera,
      rig: this.rig,
      input: this.input,
      raycaster: this.raycaster,
      audio: this.audio,
      store: this.store,
      hud: this.ui.hud,
      finish: (outcome) => this.finishGame(id, outcome),
    })
      .then((game) => {
        // Too late: games only touch the scene in start(), so an unstarted one can simply be dropped.
        if (launch !== this.launches || this.mode !== 'game') return;
        this.game = game;
        game.start();
      })
      .catch((error: unknown) => {
        console.error(error);
        if (launch !== this.launches) return;
        this.ui.toast('Permainannya gagal dimuat. Cek koneksi, lalu coba lagi.');
        this.exitGame();
      });
  }

  private finishGame(id: GameId, outcome: GameOutcome): void {
    if (this.mode !== 'game' || this.gameOver) return;
    this.gameOver = true;
    const before = this.unlockedIds();
    const newStamp = outcome.won && this.store.addStamp(id);
    this.ui.showResult(islandInfo(id), outcome, newStamp);
    this.syncProgress();
    if (newStamp) this.announceUnlocks(before);
    if (outcome.won) gsap.delayedCall(0.42, () => this.audio.stamp());
  }

  private replay(): void {
    if (this.mode !== 'game' || this.current === 'hub') return;
    this.game?.dispose();
    this.game = null;
    this.launchGame(this.current);
  }

  private exitGame(): void {
    if (this.mode !== 'game') return;
    this.launches++; // a game still downloading is no longer wanted
    this.game?.dispose();
    this.game = null;
    this.ui.hideResult();
    const built = this.world.island(this.current);
    built.gameActive = false;
    // Back on foot at the game spot, facing back towards the pier.
    const station = built.walk.station;
    const yaw = Math.atan2(built.walk.pier.x - station.x, built.walk.pier.z - station.z);
    this.walker.enter(World.walkArea(built), built.group.position, station, yaw);
    this.world.hero.place(this.walker.position, yaw);
    this.world.hero.visible = true;
    this.syncProgress();
    this.resumeWalk(yaw + Math.PI);
    if (this.store.complete && !this.store.celebrated) {
      this.ui.toast('Semua cap terkumpul. Pulang ke Labuan Fajar, ada yang menunggumu di sana.');
    }
  }

  // ------------------------------------------------------------ tools

  private cycleTime(): void {
    const day = this.world.day;
    const next = PHASES.find((phase) => phase.time > day.time + 0.03) ?? PHASES[0];
    day.goTo(next.time, 2.2);
    this.audio.click();
  }

  /** Step to the next kind of weather by hand. */
  private cycleWeather(): void {
    const weather = this.world.weather;
    const next = WEATHER_KINDS[(WEATHER_KINDS.indexOf(weather.kind) + 1) % WEATHER_KINDS.length] as WeatherKind;
    weather.cycle.set(next);
    this.ui.toast(`Cuaca: ${WEATHER_LABEL[next]}`);
    this.audio.click();
  }

  /** Rain sound, startled birds, and a word when the weather turns by itself. */
  private reactToWeather(dt: number): void {
    const world = this.world;
    this.audio.setRain(world.weather.cycle.level.rain);
    this.flutterCooldown = Math.max(0, this.flutterCooldown - dt);
    if (world.birdsFlushed > 0 && this.flutterCooldown === 0) {
      this.audio.flutter();
      this.flutterCooldown = 0.35;
    }
    const change = world.weatherChange;
    if (!change || (this.mode !== 'fly' && this.mode !== 'island')) return;
    if (change === 'hujan') this.ui.toast('Hujan turun. Burung-burung pergi berteduh.');
    else if (change === 'kabut') this.ui.toast('Kabut turun. Pulau-pulau jadi samar.');
    else if (world.weather.cycle.rainbowDue && world.day.night < 0.3 && world.day.sunDir.y > 0) {
      this.ui.toast('Hujan reda. Coba lihat ke langit.');
    }
  }

  private toggleSound(): void {
    this.store.muted = !this.store.muted;
    this.audio.start();
    this.audio.setMuted(this.store.muted);
    this.ui.setSound(this.store.muted);
  }

  private reset(): void {
    this.store.reset();
    this.world.feathers.restore(this.store.feathers);
    this.wear(DEFAULT_OUTFIT, false);
    this.syncProgress();
    this.ui.toast('Progres dihapus. Semua cap kembali kosong.');
  }

  private requestCelebration(): void {
    if (!this.store.complete) return;
    if (this.mode === 'island' && this.current === 'hub') {
      this.celebrate();
      return;
    }
    // The show happens over the harbour, so head there first; arrival sets it off.
    this.store.celebrated = false;
    if (this.mode === 'map' || this.mode === 'island' || this.mode === 'fly') this.travelTo('hub');
  }

  /** The finale: night falls over the harbour and the sky fills with fireworks. */
  private celebrate(): void {
    this.store.celebrated = true;
    const { day, fireworks } = this.world;
    const focus = this.world.island('hub').focus;
    if (day.night < 0.6) day.goTo(0.86, 3);
    this.ui.toast('Selamat! Mercusuar Labuan Fajar menyala buat kamu.');
    // Pull back to a low angle so the sky above the town fills the frame. Walking brings the camera back.
    this.rig.follow = null;
    const view = this.world.island('hub').view;
    void this.rig.flyTo({ target: focus, theta: view.theta, phi: 1.36, radius: 80 }, 2.6, ISLAND_LIMITS);
    for (let i = 0; i < 18; i++) {
      gsap.delayedCall(1.4 + i * 0.42, () => {
        const at = new THREE.Vector3((Math.random() - 0.5) * 50, 14 + Math.random() * 18, (Math.random() - 0.5) * 50).add(focus);
        fireworks.burst(at, FIREWORK_COLORS[i % FIREWORK_COLORS.length] as string, 13 + Math.random() * 5);
        this.audio.chime(Math.floor(Math.random() * 9));
      });
    }
  }

  /** Push saved progress into every part of the UI that shows it. */
  private syncProgress(): void {
    const { store } = this;
    const id = this.current;
    this.world.island('hub').lit = store.complete;
    this.world.island('ubin').restored = store.hasStamp('ubin');
    this.ui.setProgress(id, store.stamps);
    this.ui.renderStamps(store.stamps, store.records);
    this.renderExtras();
    this.ui.setPlace(islandInfo(id));
    this.ui.showTicket(islandInfo(id), {
      stamped: id !== 'hub' && store.hasStamp(id),
      record: id === 'hub' ? null : recordText(id, store.records),
      stampCount: store.stamps.length,
    });
  }

  /** Development shortcuts: ?island=ubin, ?time=0.8, ?weather=hujan, ?autostart, ?stats. */
  private applyQuery(): void {
    const query = new URLSearchParams(location.search);
    const island = query.get('island');
    if (isIslandId(island)) {
      this.current = island;
      const dock = this.world.island(island).dock;
      this.world.ship.moor(dock.position, dock.yaw);
    }
    const weather = query.get('weather');
    if (isWeatherKind(weather)) {
      this.world.weather.cycle.set(weather, true);
      this.world.weather.cycle.locked = true;
    }
    const time = Number.parseFloat(query.get('time') ?? '');
    if (Number.isFinite(time)) {
      this.world.day.time = clamp(time, 0, 0.999);
      this.world.day.paused = true;
    }
  }

  // ------------------------------------------------------------ input

  private onTap(pointer: PointerInfo): void {
    if (this.mode === 'game') {
      if (!this.gameOver) this.game?.tap?.(pointer);
      return;
    }
    if (this.mode !== 'map') return;
    const id = this.pickIsland(pointer);
    if (id) this.travelTo(id);
  }

  private onKey(key: string): void {
    if (this.mode === 'game') {
      if (key === 'Escape') this.exitGame();
      else if (!this.gameOver) this.game?.key?.(key);
      return;
    }
    if (this.mode === 'map') {
      if (key === 'Escape' || key === 'm') this.closeMap();
      else if (key === 't') this.cycleTime();
      else if (key === 'c') this.cycleWeather();
      return;
    }
    if (this.mode === 'island' && this.talk && (key === 'Escape' || key === ' ')) {
      this.endTalk();
      return;
    }
    if (this.mode === 'island' && (key === 'Escape' || key === ' ' || key === 'e' || key === 'Enter')) {
      if (key === 'Escape') this.board();
      else if (key === ' ') {
        if (!this.boarding) this.walker.jump();
      } else this.act();
      return;
    }
    if (this.mode === 'fly' && (key === 'e' || key === 'Enter')) {
      this.act();
      return;
    }
    if (key === 'm') this.openMap();
    else if (key === 't' && this.mode !== 'title') this.cycleTime();
    else if (key === 'c' && this.mode !== 'title') this.cycleWeather();
  }

  /** Nearest island under the pointer, tested against rough bounding spheres. */
  private pickIsland(pointer: PointerInfo): IslandId | null {
    this.raycaster.setFromCamera(this.ndc.set(pointer.ndcX, pointer.ndcY), this.camera);
    let best: IslandId | null = null;
    let bestDistance = Infinity;
    for (const built of this.world.islands.values()) {
      if (!this.raycaster.ray.intersectSphere(built.bounds, this.scratch)) continue;
      const distance = this.scratch.distanceToSquared(this.raycaster.ray.origin);
      if (distance < bestDistance) {
        best = built.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ frame

  private get portrait(): boolean {
    return window.innerWidth < window.innerHeight;
  }

  private resize(): void {
    this.ui.measure();
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    // A taller field of view keeps whole islands in frame on upright phones.
    if (!this.game) this.camera.fov = this.portrait ? 60 : 40;
    this.applyFraming();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
  }

  /**
   * Slide the subject out from under the panels: right of the title block, clear of the ticket.
   * On upright screens the panels sit at the bottom, so the picture moves up instead.
   */
  private setFraming(mode: Mode, duration = 1.8): void {
    const wide = !this.portrait;
    // Wide screens only shift the title shot. Upright ones lift the character above the ticket sheet.
    const x = wide && mode === 'title' ? 0.2 : 0;
    const y = wide ? 0 : mode === 'title' ? 0.12 : mode === 'island' ? 0.16 : 0;
    gsap.to(this.framing, { x, y, duration, ease: 'power3.inOut', overwrite: true, onUpdate: () => this.applyFraming() });
    if (duration === 0) this.applyFraming();
  }

  private applyFraming(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const { x, y } = this.framing;
    if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, -x * width, y * height, width, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    if (elapsed <= 0) return;
    const dt = Math.min(elapsed, 0.05);

    if (this.mode === 'game') this.game?.update(dt);
    if (this.mode === 'fly') this.updateFlight(dt);
    if (this.mode === 'island') this.updateWalk(dt);
    this.updateIslanders(dt);
    this.rig.update(dt);
    if (this.mode === 'fly' || this.mode === 'travel') this.keepCameraClear(CAMERA_HULL);
    else if (this.mode === 'island') {
      this.keepCameraClear(WALK_CAMERA_HULL);
      if (this.rig.follow === this.world.hero.anchor || this.rig.follow === this.talkFocus) this.keepCharacterInView(dt);
    }
    this.updateFov(dt);
    // On foot the moored ship sits right behind the pier; ghost it whenever it hides the character.
    this.world.ship.fadeTo(this.mode === 'island' && this.world.hero.visible && this.shipBlocksView() ? 0.16 : 1, dt);

    // Shadows follow whatever the camera is looking at, and widen as it pulls back.
    const racing = !this.rig.active;
    const focus = racing ? this.world.ship.root.position : this.rig.target;
    // In flight the camera hugs the ship, but the islands it passes still need their shadows.
    const reach =
      racing ? 70
      : this.mode === 'travel' ? 130
      : this.mode === 'fly' ? 95
      : this.mode === 'island' ? 48
      : this.rig.distance * 0.72;
    this.world.update(dt, this.camera, focus, reach);
    this.reactToWeather(dt);
    // The music takes on the colour of whichever island is nearest.
    this.audio.setMood(this.mode === 'fly' ? (this.placeShown ?? this.current) : this.current);
    this.audio.update(dt, this.world.day.night, this.world.ship.speed);

    if (this.mode === 'map' || this.mode === 'fly') this.updateMap();
    if (this.trip) this.ui.setTravelProgress((now - this.trip.started) / 1000 / this.trip.duration);
    const time = this.world.day.time;
    const kind = this.world.weather.kind;
    this.ui.setTime(kind === 'cerah' ? phaseLabel(time) : `${phaseLabel(time)}, ${WEATHER_LABEL[kind].toLowerCase()}`, clockLabel(time), time);

    this.stats?.begin();
    this.composer.render(dt);
    this.stats?.end(elapsed, this.pixelRatio);
    this.watchPerformance(elapsed);
  };

  /** Nudge the camera out of any island it has swung into, then re-aim it. */
  private keepCameraClear(hull: typeof CAMERA_HULL): void {
    const moved = resolveCollisions(this.camera.position, this.world.islands.values(), hull, this.scratch).lengthSq() > 0;
    // On foot the moored ship looms right behind the pier; never let it fill the screen.
    if (moved) this.camera.lookAt(this.rig.target);
  }

  /**
   * Does the moored ship stand between the camera and the character? The ship is treated as one
   * ellipsoid wrapping envelope and gondola; the sight line is tested in the ship's own frame.
   */
  private shipBlocksView(): boolean {
    const ship = this.world.ship.root;
    const a = ship.worldToLocal(this.scratch.copy(this.camera.position)).add(SHIP_OFFSET).divide(SHIP_EXTENT);
    const b = ship.worldToLocal(this.world.hero.anchor.position.clone()).add(SHIP_OFFSET).divide(SHIP_EXTENT);
    // Closest point of the segment a-b to the ellipsoid's centre (the origin, after scaling).
    const ab = b.clone().sub(a);
    const t = clamp(-a.dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
    return a.addScaledVector(ab, t).lengthSq() < 1;
  }

  /** Widen the view a touch at speed, which sells the sense of motion. */
  private updateFov(dt: number): void {
    if (this.mode === 'game' || !this.rig.active) return;
    const base = this.portrait ? 60 : 40;
    const target = this.mode === 'fly' ? base + this.flight.pace * 9 : base;
    if (Math.abs(this.camera.fov - target) < 0.01) return;
    this.camera.fov = damp(this.camera.fov, target, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  private updateMap(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const built of this.world.islands.values()) {
      const p = this.scratch.copy(built.label).project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15;
      this.ui.placePin(built.id, (p.x * 0.5 + 0.5) * width, (-p.y * 0.5 + 0.5) * height, visible);
    }

    if (this.mode !== 'map' || !this.input.pointerMoved) return;
    this.input.pointerMoved = false;
    const hovered = this.input.dragging ? null : this.pickIsland(this.input.pointer);
    this.ui.highlightPin(hovered);
    if (hovered) document.body.dataset.hover = hovered;
    else delete document.body.dataset.hover;
  }

  /** Trade resolution for frame rate on machines that cannot keep up. */
  private watchPerformance(elapsed: number): void {
    if (document.hidden || this.last < 4000) return;
    this.sampledFrames++;
    this.sampledTime += elapsed;
    if (this.sampledFrames < 90) return;
    const average = this.sampledTime / this.sampledFrames;
    this.sampledFrames = 0;
    this.sampledTime = 0;

    this.slowFrames = average > 1 / 40 ? this.slowFrames + 1 : 0;
    if (this.slowFrames < 2 || this.pixelRatio <= 0.75) return;
    this.slowFrames = 0;
    this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
    this.resize();
  }
}
