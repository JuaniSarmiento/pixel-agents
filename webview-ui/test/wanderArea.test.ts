/**
 * `updateCharacter`'s idle wander picked its target from `walkableTiles`
 * covering the WHOLE office, with no regard for Areas — an agent seated in
 * one department could wander clean across the building into another.
 *
 * This test seats a character in a "left" Area and offers a candidate list
 * where the single tile in "right" sorts first. `Math.random` is mocked to
 * 0 so the (buggy) unfiltered pick would deterministically land on that
 * "right" tile; the fix must filter to the character's own Area first.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import type { Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

const COLS = 10;

/** 1-row, all-floor tile map — every tile walkable, no obstructions. */
function floorTileMap(): TileType[][] {
  return [new Array<TileType>(COLS).fill(TileType.FLOOR_1)];
}

/** Area labels for a 1-row grid: cols 0-2 "left", cols 5-9 "right". */
function splitAreaTiles(): Array<string | null> {
  const areaTiles = new Array<string | null>(COLS).fill(null);
  for (let c = 0; c < COLS; c++) areaTiles[c] = c <= 2 ? 'left' : 'right';
  return areaTiles;
}

function seatAt(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: true };
}

/** Puts a freshly-seated character into the idle wander decision point:
 *  inactive, idle, and with a wander timer about to expire this tick. */
function readyToWander(seat: Seat) {
  const ch = createCharacter(1, 0, 'seat-left', seat);
  ch.isActive = false;
  ch.state = CharacterState.IDLE;
  ch.wanderTimer = 0.001;
  ch.wanderCount = 0;
  ch.wanderLimit = 10;
  return ch;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("wander target stays inside the character's own Area even when the nearest candidate (by random pick order) is in another Area", () => {
  const seats = new Map<string, Seat>([['seat-left', seatAt('seat-left', 0, 0)]]);
  const ch = readyToWander(seats.get('seat-left')!);
  const tileMap = floorTileMap();
  const blockedTiles = new Set<string>();
  const areaTiles = splitAreaTiles();

  // Index 0 is in "right" — with Math.random mocked to 0, an unfiltered pick
  // takes this one. Indices 1 and 2 are in "left", the character's own Area.
  const walkableTiles = [
    { col: 7, row: 0 }, // right
    { col: 1, row: 0 }, // left
    { col: 2, row: 0 }, // left
  ];

  updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles, areaTiles);

  assert.equal(ch.state, CharacterState.WALK, 'picked a target and started walking');
  const target = ch.path[ch.path.length - 1];
  assert.notDeepEqual(
    [target.col, target.row],
    [7, 0],
    'must not wander into the neighboring Area',
  );
  assert.ok(
    target.col === 1 || target.col === 2,
    `target (${target.col},${target.row}) must be inside the "left" Area`,
  );
});

test('falls back to the whole office when the character has no seat (no Area to match)', () => {
  const seats = new Map<string, Seat>();
  const ch = createCharacter(2, 0, null, null);
  ch.isActive = false;
  ch.state = CharacterState.IDLE;
  ch.wanderTimer = 0.001;
  ch.wanderCount = 0;
  ch.wanderLimit = 10;
  ch.tileCol = 0;
  ch.tileRow = 0;
  const tileMap = floorTileMap();
  const blockedTiles = new Set<string>();
  const areaTiles = splitAreaTiles();

  const walkableTiles = [
    { col: 7, row: 0 }, // right — the seatless character has no Area, so this is fair game
    { col: 1, row: 0 }, // left
  ];

  updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles, areaTiles);

  assert.equal(ch.state, CharacterState.WALK);
  const target = ch.path[ch.path.length - 1];
  assert.deepEqual(
    [target.col, target.row],
    [7, 0],
    'no Area to anchor to, so the full-office pick (index 0 under the mocked random) stands',
  );
});
