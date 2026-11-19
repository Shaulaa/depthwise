import { describe, expect, it } from 'vitest';
import { Store, sanitizeSave } from '../src/core/Store';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('sanitizeSave', () => {
  it('falls back to an empty save for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'x', []]) {
      expect(sanitizeSave(junk)).toEqual({
        stamps: [],
        records: {},
        muted: false,
        celebrated: false,
        feathers: [],
        outfit: 'pelaut',
      });
    }
  });

  it('keeps known stamps only, without duplicates', () => {
    const save = sanitizeSave({ stamps: ['ubin', 'hub', 'ubin', 'nope', 'lentera', 7] });
    expect(save.stamps).toEqual(['ubin', 'lentera']);
  });

  it('drops malformed records and keeps valid ones', () => {
    const save = sanitizeSave({
      records: {
        ubin: { moves: 30, time: 'fast' },
        rimba: { time: 12.5 },
        angin: { rings: Number.NaN },
        lentera: { lives: 2 },
      },
    });
    expect(save.records).toEqual({ rimba: { time: 12.5 }, lentera: { lives: 2 } });
  });

  it('keeps well-formed feathers once and a plausible outfit name', () => {
    const save = sanitizeSave({ feathers: ['ubin-0', 'ubin-0', 'moon-1', 3, 'hub-2'], outfit: 'senja' });
    expect(save.feathers).toEqual(['ubin-0', 'hub-2']);
    expect(save.outfit).toBe('senja');
    expect(sanitizeSave({ outfit: '<script>' }).outfit).toBe('pelaut');
  });

  it('only treats literal true as a set flag', () => {
    expect(sanitizeSave({ muted: 'yes', celebrated: 1 })).toMatchObject({ muted: false, celebrated: false });
    expect(sanitizeSave({ muted: true, celebrated: true })).toMatchObject({ muted: true, celebrated: true });
  });
});

describe('Store', () => {
  it('awards each stamp once and reports completion', () => {
    const store = new Store(new MemoryStorage());
    expect(store.addStamp('ubin')).toBe(true);
    expect(store.addStamp('ubin')).toBe(false);
    expect(store.complete).toBe(false);
    for (const id of ['rimba', 'angin', 'lentera'] as const) store.addStamp(id);
    expect(store.complete).toBe(true);
  });

  it('keeps only the better result for each game', () => {
    const store = new Store(new MemoryStorage());
    expect(store.submit('ubin', { moves: 40, time: 60 })).toBe(true);
    expect(store.submit('ubin', { moves: 50, time: 10 })).toBe(false);
    expect(store.submit('ubin', { moves: 40, time: 55 })).toBe(true); // same moves, faster
    expect(store.records.ubin).toEqual({ moves: 40, time: 55 });

    expect(store.submit('rimba', { time: 30 })).toBe(true);
    expect(store.submit('rimba', { time: 31 })).toBe(false);

    expect(store.submit('angin', { rings: 9 })).toBe(true);
    expect(store.submit('angin', { rings: 8 })).toBe(false);
    expect(store.submit('angin', { rings: 12 })).toBe(true);

    expect(store.submit('lentera', { lives: 1 })).toBe(true);
    expect(store.submit('lentera', { lives: 1 })).toBe(false);
    expect(store.submit('lentera', { lives: 3 })).toBe(true);
  });

  it('persists across instances that share storage', () => {
    const storage = new MemoryStorage();
    const first = new Store(storage);
    first.addStamp('angin');
    first.submit('angin', { rings: 11 });
    first.muted = true;

    const second = new Store(storage);
    expect(second.hasStamp('angin')).toBe(true);
    expect(second.records.angin).toEqual({ rings: 11 });
    expect(second.muted).toBe(true);
  });

  it('counts each feather once and remembers the outfit', () => {
    const storage = new MemoryStorage();
    const store = new Store(storage);
    expect(store.addFeather('rimba-1')).toBe(true);
    expect(store.addFeather('rimba-1')).toBe(false);
    expect(store.addFeather('nowhere-1')).toBe(false);
    store.outfit = 'laut';
    const again = new Store(storage);
    expect(again.feathers).toEqual(['rimba-1']);
    expect(again.outfit).toBe('laut');
  });

  it('reset clears progress but keeps the sound preference', () => {
    const store = new Store(new MemoryStorage());
    store.addStamp('ubin');
    store.submit('rimba', { time: 9 });
    store.celebrated = true;
    store.muted = true;
    store.reset();
    expect(store.stamps).toEqual([]);
    expect(store.records).toEqual({});
    expect(store.celebrated).toBe(false);
    expect(store.muted).toBe(true);
  });

  it('survives corrupt, missing or failing storage', () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem('depthwise:v1', '{not json');
    expect(new Store(corrupt).stamps).toEqual([]);

    expect(new Store(null).addStamp('ubin')).toBe(true);

    const failing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('quota');
      },
      removeItem: (): void => undefined,
    };
    const store = new Store(failing);
    expect(() => store.addStamp('rimba')).not.toThrow();
    expect(store.hasStamp('rimba')).toBe(true); // still tracked for this session
  });
});
