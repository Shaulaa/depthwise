import type { GameId } from '../core/Store';
import type { GameContext, MiniGame } from './types';

/**
 * Each mini game lives in its own chunk and is only downloaded when someone starts it,
 * which keeps the first load down to the world itself.
 */
export async function createGame(id: GameId, ctx: GameContext): Promise<MiniGame> {
  switch (id) {
    case 'ubin':
      return new (await import('./SlidingPuzzle')).SlidingPuzzle(ctx);
    case 'rimba':
      return new (await import('./HiddenCrystals')).HiddenCrystals(ctx);
    case 'angin':
      return new (await import('./RingRace')).RingRace(ctx);
    default:
      return new (await import('./LanternMemory')).LanternMemory(ctx);
  }
}

/** Start fetching a game's code early, for instance when the player walks up to its spot. */
export function prefetchGame(id: GameId): void {
  switch (id) {
    case 'ubin':
      void import('./SlidingPuzzle');
      break;
    case 'rimba':
      void import('./HiddenCrystals');
      break;
    case 'angin':
      void import('./RingRace');
      break;
    default:
      void import('./LanternMemory');
  }
}

export type { GameContext, GameHud, GameOutcome, MiniGame } from './types';
