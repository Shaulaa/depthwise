export type GameId = 'ubin' | 'rimba' | 'angin' | 'lentera';
export const GAME_IDS: readonly GameId[] = ['ubin', 'rimba', 'angin', 'lentera'];

/** Best results per mini game. Lower is better for time/moves, higher for rings/lives. */
export interface Records {
  ubin?: { moves: number; time: number };
  rimba?: { time: number };
  angin?: { rings: number };
  lentera?: { lives: number };
}

export interface SaveData {
  stamps: GameId[];
  records: Records;
  muted: boolean;
  /** The finale has played once already, so it no longer starts on its own. */
  celebrated: boolean;
  /** Wind feathers picked up, as "<island>-<index>". */
  feathers: string[];
  /** Costume the sky sailor wears. */
  outfit: string;
}

const KEY = 'depthwise:v1';

export const DEFAULT_OUTFIT = 'pelaut';
const FEATHER_ID = /^(hub|ubin|rimba|angin|lentera)-\d$/;
const OUTFIT_ID = /^[a-z]{1,16}$/;

const emptySave = (): SaveData => ({
  stamps: [],
  records: {},
  muted: false,
  celebrated: false,
  feathers: [],
  outfit: DEFAULT_OUTFIT,
});

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Accepts anything read from storage and returns a well-formed save. */
export function sanitizeSave(raw: unknown): SaveData {
  const save = emptySave();
  if (!isObject(raw)) return save;

  if (Array.isArray(raw.stamps)) {
    for (const id of GAME_IDS) if (raw.stamps.includes(id)) save.stamps.push(id);
  }
  save.muted = raw.muted === true;
  save.celebrated = raw.celebrated === true;
  if (Array.isArray(raw.feathers)) {
    for (const id of raw.feathers) {
      if (typeof id === 'string' && FEATHER_ID.test(id) && !save.feathers.includes(id)) save.feathers.push(id);
    }
  }
  if (typeof raw.outfit === 'string' && OUTFIT_ID.test(raw.outfit)) save.outfit = raw.outfit;

  const r = isObject(raw.records) ? raw.records : {};
  if (isObject(r.ubin) && isFiniteNumber(r.ubin.moves) && isFiniteNumber(r.ubin.time)) {
    save.records.ubin = { moves: r.ubin.moves, time: r.ubin.time };
  }
  if (isObject(r.rimba) && isFiniteNumber(r.rimba.time)) save.records.rimba = { time: r.rimba.time };
  if (isObject(r.angin) && isFiniteNumber(r.angin.rings)) save.records.angin = { rings: r.angin.rings };
  if (isObject(r.lentera) && isFiniteNumber(r.lentera.lives)) save.records.lentera = { lives: r.lentera.lives };
  return save;
}

/** Progress persistence. Falls back to in-memory state when storage is unavailable. */
export class Store {
  private data: SaveData;

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = defaultStorage()) {
    this.data = this.read();
  }

  private read(): SaveData {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? sanitizeSave(JSON.parse(raw)) : emptySave();
    } catch {
      return emptySave();
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: progress simply lasts for this session.
    }
  }

  get stamps(): readonly GameId[] {
    return this.data.stamps;
  }

  get records(): Readonly<Records> {
    return this.data.records;
  }

  get muted(): boolean {
    return this.data.muted;
  }

  set muted(value: boolean) {
    this.data.muted = value;
    this.write();
  }

  get celebrated(): boolean {
    return this.data.celebrated;
  }

  set celebrated(value: boolean) {
    this.data.celebrated = value;
    this.write();
  }

  get feathers(): readonly string[] {
    return this.data.feathers;
  }

  /** Returns true when the feather was not picked up before. */
  addFeather(id: string): boolean {
    if (!FEATHER_ID.test(id) || this.data.feathers.includes(id)) return false;
    this.data.feathers.push(id);
    this.write();
    return true;
  }

  get outfit(): string {
    return this.data.outfit;
  }

  set outfit(id: string) {
    if (!OUTFIT_ID.test(id)) return;
    this.data.outfit = id;
    this.write();
  }

  hasStamp(id: GameId): boolean {
    return this.data.stamps.includes(id);
  }

  get complete(): boolean {
    return GAME_IDS.every((id) => this.hasStamp(id));
  }

  /** Returns true when this is the first time the stamp is earned. */
  addStamp(id: GameId): boolean {
    if (this.hasStamp(id)) return false;
    this.data.stamps.push(id);
    this.write();
    return true;
  }

  /** Stores the result if it beats the previous one. Returns true for a new best. */
  submit<K extends GameId>(id: K, result: NonNullable<Records[K]>): boolean {
    const prev = this.data.records[id];
    if (prev && !isBetter(id, result, prev)) return false;
    (this.data.records as Record<GameId, unknown>)[id] = result;
    this.write();
    return true;
  }

  reset(): void {
    const muted = this.data.muted;
    this.data = { ...emptySave(), muted };
    this.write();
  }
}

function isBetter<K extends GameId>(id: K, next: NonNullable<Records[K]>, prev: NonNullable<Records[K]>): boolean {
  switch (id) {
    case 'ubin': {
      const a = next as NonNullable<Records['ubin']>;
      const b = prev as NonNullable<Records['ubin']>;
      return a.moves < b.moves || (a.moves === b.moves && a.time < b.time);
    }
    case 'rimba':
      return (next as NonNullable<Records['rimba']>).time < (prev as NonNullable<Records['rimba']>).time;
    case 'angin':
      return (next as NonNullable<Records['angin']>).rings > (prev as NonNullable<Records['angin']>).rings;
    default:
      return (next as NonNullable<Records['lentera']>).lives > (prev as NonNullable<Records['lentera']>).lives;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
