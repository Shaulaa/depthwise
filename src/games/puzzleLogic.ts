import type { Rng } from '../core/math';

export const SIZE = 3;
export const CELLS = SIZE * SIZE;
/** Tile id that stands for the gap. */
export const EMPTY = CELLS - 1;

/** board[cell] is the id of the tile sitting in that cell. Cells run left to right, top to bottom. */
export type Board = number[];
export type Direction = 'up' | 'down' | 'left' | 'right';

export const solvedBoard = (): Board => Array.from({ length: CELLS }, (_, i) => i);

export const isSolved = (board: Board): boolean => board.every((tile, cell) => tile === cell);

export const emptyCell = (board: Board): number => board.indexOf(EMPTY);

export function neighbours(cell: number): number[] {
  const col = cell % SIZE;
  const row = Math.floor(cell / SIZE);
  const out: number[] = [];
  if (row > 0) out.push(cell - SIZE);
  if (row < SIZE - 1) out.push(cell + SIZE);
  if (col > 0) out.push(cell - 1);
  if (col < SIZE - 1) out.push(cell + 1);
  return out;
}

export const canMove = (board: Board, cell: number): boolean =>
  cell >= 0 && cell < CELLS && board[cell] !== EMPTY && neighbours(cell).includes(emptyCell(board));

/** Slide the tile in `cell` into the gap. Returns the new board, or null if the move is illegal. */
export function move(board: Board, cell: number): Board | null {
  if (!canMove(board, cell)) return null;
  const next = board.slice();
  const gap = emptyCell(board);
  next[gap] = board[cell] as number;
  next[cell] = EMPTY;
  return next;
}

/** The cell whose tile would slide in `direction` to fill the gap, if there is one. */
export function cellToSlide(board: Board, direction: Direction): number | null {
  const gap = emptyCell(board);
  const col = gap % SIZE;
  const row = Math.floor(gap / SIZE);
  switch (direction) {
    case 'up':
      return row < SIZE - 1 ? gap + SIZE : null;
    case 'down':
      return row > 0 ? gap - SIZE : null;
    case 'left':
      return col < SIZE - 1 ? gap + 1 : null;
    default:
      return col > 0 ? gap - 1 : null;
  }
}

/**
 * Scramble by walking the gap around, which can only ever reach solvable positions.
 * Never returns the solved board.
 */
export function shuffle(rng: Rng, steps = 90): Board {
  let board = solvedBoard();
  let previous = -1;
  for (let i = 0; i < steps || isSolved(board); i++) {
    const gap = emptyCell(board);
    const options = neighbours(gap).filter((cell) => cell !== previous);
    const cell = options[Math.floor(rng() * options.length)] as number;
    board = move(board, cell) as Board;
    previous = gap;
  }
  return board;
}

/** Parity test for odd-width boards: solvable exactly when the inversion count is even. */
export function isSolvable(board: Board): boolean {
  const tiles = board.filter((tile) => tile !== EMPTY);
  let inversions = 0;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if ((tiles[i] as number) > (tiles[j] as number)) inversions++;
    }
  }
  return inversions % 2 === 0;
}
