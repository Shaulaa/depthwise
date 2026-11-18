import * as THREE from 'three';
import gsap from 'gsap';
import { formatTime, mulberry32 } from '../core/math';
import { CELLS, EMPTY, SIZE, cellToSlide, isSolved, move, shuffle, solvedBoard, type Board, type Direction } from './puzzleLogic';
import { Scheduler, type GameContext, type MiniGame } from './types';
import type { PointerInfo } from '../core/Input';
import { drawMosaic } from '../world/mosaic';

const TILE = 3.4;
const GAP = 0.16;
const THICKNESS = 0.5;

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

export class SlidingPuzzle implements MiniGame {
  private readonly group = new THREE.Group();
  private readonly tiles: THREE.Group[] = [];
  private readonly targets: THREE.Mesh[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly scheduler = new Scheduler();
  private readonly rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
  private readonly pointer = new THREE.Vector2();
  private board: Board = solvedBoard();
  private moves = 0;
  private time = 0;
  private playing = false;
  private solved = false;

  constructor(private readonly ctx: GameContext) {}

  start(): void {
    const { ctx } = this;
    const origin = ctx.built.puzzleOrigin;
    if (!origin) throw new Error('This island has no puzzle plaza.');

    const canvas = drawMosaic(true);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const face = new THREE.MeshLambertMaterial({ map: texture });
    const stone = new THREE.MeshLambertMaterial({ color: '#cfc4a8' });
    const block = new THREE.BoxGeometry(TILE - GAP, THICKNESS, TILE - GAP);
    this.disposables.push(texture, face, stone, block);

    for (let id = 0; id < CELLS; id++) {
      const col = id % SIZE;
      const row = Math.floor(id / SIZE);
      const top = new THREE.PlaneGeometry(TILE - GAP - 0.08, TILE - GAP - 0.08);
      // Crop the plane's UVs to this tile's square of the picture (row 0 is the top).
      const uv = top.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (col + uv.getX(i)) / SIZE, (SIZE - 1 - row + uv.getY(i)) / SIZE);
      }
      top.rotateX(-Math.PI / 2);
      this.disposables.push(top);

      const body = new THREE.Mesh(block, stone);
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.tile = id;
      const picture = new THREE.Mesh(top, face);
      picture.position.y = THICKNESS / 2 + 0.012;
      picture.receiveShadow = true;

      const tile = new THREE.Group();
      tile.add(body, picture);
      this.place(tile, id);
      this.tiles.push(tile);
      this.targets.push(body);
      this.group.add(tile);
    }

    this.group.position.copy(origin);
    ctx.world.scene.add(this.group);
    ctx.built.gameActive = true;

    ctx.hud.setPreview(canvas.toDataURL('image/jpeg', 0.8));
    ctx.hud.setActions([{ label: 'Acak ulang', onClick: () => this.scramble() }]);
    ctx.hud.setHint('Klik ubin di sebelah celah buat menggesernya. Tombol panah juga bisa.');
    this.refresh();

    void ctx.rig.flyTo(
      { target: origin.clone().setY(origin.y + 0.4), theta: 0, phi: 0.5, radius: 25 },
      1.6,
      { minPhi: 0.12, maxPhi: 1.05, minRadius: 16, maxRadius: 38 },
    );
    // Let the player see the finished picture for a beat before it is scrambled.
    this.scheduler.after(1.5, () => this.scramble());
  }

  update(dt: number): void {
    this.scheduler.update(dt);
    if (!this.playing) return;
    this.time += dt;
    this.refresh();
  }

  tap(pointer: PointerInfo): void {
    if (!this.playing) return;
    this.pointer.set(pointer.ndcX, pointer.ndcY);
    this.ctx.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    const hit = this.ctx.raycaster.intersectObjects(this.targets, false)[0];
    if (!hit) return;
    this.slide(this.board.indexOf(hit.object.userData.tile as number));
  }

  key(key: string): void {
    const direction = KEY_DIRECTIONS[key];
    if (!this.playing || !direction) return;
    const cell = cellToSlide(this.board, direction);
    if (cell !== null) this.slide(cell);
  }

  dispose(): void {
    this.scheduler.clear();
    for (const tile of this.tiles) gsap.killTweensOf([tile.position, tile.scale]);
    this.ctx.world.scene.remove(this.group);
    this.ctx.built.gameActive = false;
    for (const item of this.disposables) item.dispose();
  }

  private cellX(cell: number): number {
    return ((cell % SIZE) - (SIZE - 1) / 2) * TILE;
  }

  private cellZ(cell: number): number {
    return (Math.floor(cell / SIZE) - (SIZE - 1) / 2) * TILE;
  }

  private place(tile: THREE.Group, cell: number): void {
    tile.position.set(this.cellX(cell), THICKNESS / 2, this.cellZ(cell));
  }

  private scramble(): void {
    if (this.solved) return;
    this.playing = false;
    this.board = shuffle(this.rng);
    this.moves = 0;
    this.time = 0;
    this.refresh();
    this.ctx.audio.slide();

    this.tiles.forEach((tile, id) => {
      gsap.killTweensOf([tile.position, tile.scale]);
      if (id === EMPTY) {
        gsap.to(tile.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, onComplete: () => void (tile.visible = false) });
        return;
      }
      const cell = this.board.indexOf(id);
      const delay = id * 0.035;
      gsap.to(tile.position, { x: this.cellX(cell), z: this.cellZ(cell), duration: 0.6, delay, ease: 'power2.inOut' });
      // Hop over the neighbours so tiles never slide through each other.
      gsap.to(tile.position, { y: THICKNESS / 2 + 0.9 + id * 0.12, duration: 0.3, delay, yoyo: true, repeat: 1, ease: 'sine.out' });
    });
    this.scheduler.after(0.95, () => {
      this.playing = true;
    });
  }

  private slide(cell: number): void {
    const id = this.board[cell] as number;
    const next = move(this.board, cell);
    if (!next) return;
    this.board = next;
    this.moves++;
    this.ctx.audio.slide();
    const landed = next.indexOf(id);
    const tile = this.tiles[id] as THREE.Group;
    gsap.to(tile.position, { x: this.cellX(landed), z: this.cellZ(landed), duration: 0.2, ease: 'power2.out', overwrite: true });
    this.refresh();
    if (isSolved(this.board)) this.win();
  }

  private win(): void {
    const { ctx } = this;
    this.playing = false;
    this.solved = true;
    const last = this.tiles[EMPTY] as THREE.Group;
    this.place(last, EMPTY);
    last.visible = true;
    gsap.fromTo(last.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 1, y: 1, z: 1, duration: 0.5, delay: 0.2, ease: 'back.out(2.2)' });
    this.tiles.forEach((tile, id) => {
      gsap.to(tile.position, { y: THICKNESS / 2 + 0.7, duration: 0.2, delay: 0.5 + id * 0.05, yoyo: true, repeat: 1, ease: 'sine.out' });
    });

    ctx.audio.success();
    const above = this.group.position.clone();
    above.y += 9;
    ['#ffd76a', '#ff8f6b', '#8ff3dc'].forEach((color, i) => {
      this.scheduler.after(0.3 + i * 0.3, () => ctx.world.fireworks.burst(above.clone().add(new THREE.Vector3((i - 1) * 6, i * 1.5, 0)), color, 11));
    });

    const result = { moves: this.moves, time: this.time };
    const best = ctx.store.submit('ubin', result);
    const record = ctx.store.records.ubin;
    this.scheduler.after(1.7, () =>
      ctx.finish({
        won: true,
        headline: 'Mozaiknya utuh lagi',
        lines: [
          `${result.moves} langkah dalam ${formatTime(result.time)}`,
          best ? 'Rekor baru!' : `Rekor kamu: ${record?.moves ?? result.moves} langkah`,
        ],
      }),
    );
  }

  private refresh(): void {
    this.ctx.hud.setStats([
      { label: 'Langkah', value: String(this.moves) },
      { label: 'Waktu', value: formatTime(this.time) },
    ]);
  }
}
