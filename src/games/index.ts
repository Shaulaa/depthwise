import type { GameId } from '../core/Store';
import { HiddenCrystals } from './HiddenCrystals';
import { LanternMemory } from './LanternMemory';
import { RingRace } from './RingRace';
import { SlidingPuzzle } from './SlidingPuzzle';
import type { GameContext, MiniGame } from './types';

export function createGame(id: GameId, ctx: GameContext): MiniGame {
  switch (id) {
    case 'ubin':
      return new SlidingPuzzle(ctx);
    case 'rimba':
      return new HiddenCrystals(ctx);
    case 'angin':
      return new RingRace(ctx);
    default:
      return new LanternMemory(ctx);
  }
}

export type { GameContext, GameHud, GameOutcome, MiniGame } from './types';
