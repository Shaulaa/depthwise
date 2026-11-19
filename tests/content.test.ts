import { describe, expect, it } from 'vitest';
import { ISLANDS, NPCS, OUTFITS, outfitUnlocked, type Progress } from '../src/content';
import { DEFAULT_OUTFIT, GAME_IDS, type GameId } from '../src/core/Store';

const progress = (stamps: readonly GameId[], feathers: number, record: string | null = null): Progress => ({
  stamps,
  feathers,
  featherTotal: 15,
  record: () => record,
});

describe('outfits', () => {
  it('start with the default costume unlocked and nothing else for free', () => {
    const open = OUTFITS.filter((o) => outfitUnlocked(o, 0, 0, 15)).map((o) => o.id);
    expect(open).toEqual([DEFAULT_OUTFIT]);
  });

  it('unlock one costume per stamp, and the feather costume only with every feather', () => {
    expect(OUTFITS.filter((o) => outfitUnlocked(o, 2, 0, 15))).toHaveLength(3);
    expect(OUTFITS.filter((o) => outfitUnlocked(o, 4, 14, 15))).toHaveLength(5);
    expect(OUTFITS.every((o) => outfitUnlocked(o, 4, 15, 15))).toBe(true);
  });

  it('have unique, storable ids', () => {
    const ids = OUTFITS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]{1,16}$/);
  });
});

describe('islanders', () => {
  it('each live on a real island and have something to say at every stage', () => {
    const islands = new Set(ISLANDS.map((i) => i.id));
    for (const npc of NPCS) {
      expect(islands.has(npc.island)).toBe(true);
      for (const state of [progress([], 0), progress(GAME_IDS, 15, '12 cincin'), progress(['ubin'], 7)]) {
        const lines = npc.lines(state);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.trim().length).toBeGreaterThan(0);
          expect(line).not.toMatch(/undefined|null|NaN/);
        }
      }
    }
  });

  it('react to progress', () => {
    const laras = NPCS.find((n) => n.id === 'laras');
    expect(laras?.lines(progress([], 3)).join(' ')).toContain('3 dari 15');
    expect(laras?.lines(progress([], 15)).join(' ')).toContain('Semua bulu');
  });
});
