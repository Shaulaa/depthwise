import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/math';
import {
  CELLS,
  EMPTY,
  canMove,
  cellToSlide,
  emptyCell,
  isSolvable,
  isSolved,
  move,
  neighbours,
  shuffle,
  solvedBoard,
} from '../src/games/puzzleLogic';

describe('sliding puzzle board', () => {
  it('starts solved with the gap in the last cell', () => {
    const board = solvedBoard();
    expect(board).toHaveLength(CELLS);
    expect(isSolved(board)).toBe(true);
    expect(emptyCell(board)).toBe(CELLS - 1);
  });

  it('lists only orthogonal neighbours and respects the edges', () => {
    expect(neighbours(0).sort()).toEqual([1, 3]);
    expect(neighbours(4).sort()).toEqual([1, 3, 5, 7]);
    expect(neighbours(8).sort()).toEqual([5, 7]);
    // Cell 2 ends a row, so cell 3 on the next row is not beside it.
    expect(neighbours(2)).not.toContain(3);
  });

  it('only lets tiles next to the gap move', () => {
    const board = solvedBoard();
    expect(canMove(board, 7)).toBe(true);
    expect(canMove(board, 5)).toBe(true);
    expect(canMove(board, 0)).toBe(false);
    expect(canMove(board, 8)).toBe(false); // the gap itself
    expect(canMove(board, -1)).toBe(false);
    expect(canMove(board, 99)).toBe(false);
  });

  it('slides a tile into the gap without mutating the original board', () => {
    const board = solvedBoard();
    const next = move(board, 7);
    expect(next).toEqual([0, 1, 2, 3, 4, 5, 6, EMPTY, 7]);
    expect(board).toEqual(solvedBoard());
    expect(move(board, 0)).toBeNull();
  });

  it('maps a direction to the tile that would travel that way', () => {
    const board = [0, 1, 2, 3, EMPTY, 5, 6, 7, 4]; // gap in the centre
    expect(cellToSlide(board, 'up')).toBe(7);
    expect(cellToSlide(board, 'down')).toBe(1);
    expect(cellToSlide(board, 'left')).toBe(5);
    expect(cellToSlide(board, 'right')).toBe(3);
  });

  it('returns no tile when the gap sits against the matching edge', () => {
    const board = solvedBoard(); // gap bottom-right
    expect(cellToSlide(board, 'up')).toBeNull();
    expect(cellToSlide(board, 'left')).toBeNull();
    expect(cellToSlide(board, 'down')).toBe(5);
    expect(cellToSlide(board, 'right')).toBe(7);
  });

  it('is solved again after undoing a move', () => {
    const moved = move(solvedBoard(), 7);
    expect(moved).not.toBeNull();
    expect(isSolved(moved as number[])).toBe(false);
    const back = move(moved as number[], 8);
    expect(isSolved(back as number[])).toBe(true);
  });
});

describe('shuffle', () => {
  it('always produces a solvable, unsolved permutation', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const board = shuffle(mulberry32(seed));
      expect([...board].sort((a, b) => a - b)).toEqual(solvedBoard());
      expect(isSolved(board)).toBe(false);
      expect(isSolvable(board)).toBe(true);
    }
  });

  it('never hands back the solved board, even when asked for zero steps', () => {
    expect(isSolved(shuffle(mulberry32(5), 0))).toBe(false);
  });

  it('recognises an unsolvable arrangement', () => {
    // Swapping two tiles of a solved board flips the parity.
    expect(isSolvable([1, 0, 2, 3, 4, 5, 6, 7, EMPTY])).toBe(false);
  });
});
