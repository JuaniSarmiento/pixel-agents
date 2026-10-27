/**
 * `addSubagent` placed every sub-agent at the walkable tile closest to the
 * parent, with no regard for Areas. On an office divided into Areas, the
 * nearest free tile to a parent sitting at an Area boundary is often in the
 * NEIGHBORING Area rather than the parent's own — sub-agents then appear to
 * wander into the wrong department.
 *
 * These tests build a layout where the single closest free tile to the
 * parent's seat is deliberately in the other Area (its only same-row, same-
 * column neighbors are voided), while free tiles inside the parent's own Area
 * remain available elsewhere. The sub-agent must land in the parent's Area,
 * not the nearer-but-wrong one. A parent with no seat (no Area to match)
 * keeps the old nearest-free-tile fallback.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, Seat } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

const COLS = 9;
const ROWS = 7;

/** All-floor 9x7 layout split into two equal-width Areas: "left" (cols 0-3)
 *  and "right" (cols 4-8). */
function splitAreaLayout(): OfficeLayout {
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  const areaTiles = new Array<string | null>(COLS * ROWS).fill(null);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      areaTiles[r * COLS + c] = c <= 3 ? 'left' : 'right';
    }
  }
  return { version: 1, cols: COLS, rows: ROWS, tiles, furniture: [], areaTiles };
}

function voidTile(layout: OfficeLayout, col: number, row: number): void {
  layout.tiles[row * COLS + col] = TileType.VOID;
}

function seatAt(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: false };
}

function areaLabelAt(layout: OfficeLayout, col: number, row: number): string | null {
  return layout.areaTiles![row * COLS + col] ?? null;
}

test("sub-agent lands in the parent's Area, not the nearer tile across the boundary", () => {
  const layout = splitAreaLayout();
  // Parent sits at (3,3), the rightmost tile of "left". Void its up/down/left
  // neighbors so the single remaining distance-1 free tile is (4,3) — "right".
  voidTile(layout, 3, 2);
  voidTile(layout, 3, 4);
  voidTile(layout, 2, 3);

  const os = new OfficeState(layout);
  os.seats.set('seat-left', seatAt('seat-left', 3, 3));
  os.addAgent(1, 0, 0, 'seat-left');
  assert.equal(os.characters.get(1)!.tileCol, 3);
  assert.equal(os.characters.get(1)!.tileRow, 3);

  const subId = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(subId)!;

  assert.notDeepEqual(
    [sub.tileCol, sub.tileRow],
    [4, 3],
    'must not take the nearer tile that belongs to the other Area',
  );
  assert.equal(
    areaLabelAt(layout, sub.tileCol, sub.tileRow),
    'left',
    "sub-agent's tile must carry the parent's own Area label",
  );
});

test("sub-agent lands in the parent's Area even when that Area is on the other side (triangulation)", () => {
  const layout = splitAreaLayout();
  // Mirror image: parent at (4,3), the leftmost tile of "right". Void its
  // up/down/right neighbors so the nearest free tile is (3,3) — "left".
  voidTile(layout, 4, 2);
  voidTile(layout, 4, 4);
  voidTile(layout, 5, 3);

  const os = new OfficeState(layout);
  os.seats.set('seat-right', seatAt('seat-right', 4, 3));
  os.addAgent(1, 0, 0, 'seat-right');
  assert.equal(os.characters.get(1)!.tileCol, 4);
  assert.equal(os.characters.get(1)!.tileRow, 3);

  const subId = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(subId)!;

  assert.notDeepEqual(
    [sub.tileCol, sub.tileRow],
    [3, 3],
    'must not take the nearer tile that belongs to the other Area',
  );
  assert.equal(
    areaLabelAt(layout, sub.tileCol, sub.tileRow),
    'right',
    "sub-agent's tile must carry the parent's own Area label",
  );
});

test('falls back to the closest free tile when the parent has no seat (no Area to match)', () => {
  // No seats at all defined -> addAgent places the parent at a random
  // walkable tile with seatId === null. addSubagent has no Area to consult
  // and must keep the old nearest-free-tile behavior.
  const layout = splitAreaLayout();
  const os = new OfficeState(layout);
  os.addAgent(1, 0, 0);
  const parent = os.characters.get(1)!;
  assert.equal(parent.seatId, null, 'no seats exist, so the agent has none');

  const subId = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(subId)!;
  const dist = Math.abs(sub.tileCol - parent.tileCol) + Math.abs(sub.tileRow - parent.tileRow);
  assert.equal(dist, 1, 'still the closest free tile to the parent, one step away');
});

test('flattened descendants reserve distinct free seats in the visible lead Area and sit there', () => {
  const layout = splitAreaLayout();
  const os = new OfficeState(layout);
  os.seats.set('lead', seatAt('lead', 3, 3));
  os.seats.set('left-a', seatAt('left-a', 0, 1));
  os.seats.set('left-b', seatAt('left-b', 1, 1));
  os.seats.set('near-right', seatAt('near-right', 4, 3));
  os.addAgent(1, 0, 0, 'lead');
  const first = os.addSubagent(1, 'subagent:1000001');
  const second = os.addSubagent(1, 'subagent:1000002');
  const one = os.characters.get(first)!;
  const two = os.characters.get(second)!;
  assert.ok(one.seatId, 'first descendant must own a seat');
  assert.ok(two.seatId, 'second descendant must own a seat');
  assert.notEqual(one.seatId, two.seatId);
  assert.equal(os.seatZone(one.seatId), 'left');
  assert.equal(os.seatZone(two.seatId), 'left');
  assert.equal(os.seats.get(one.seatId)!.assigned, true);
  assert.equal(os.seats.get(two.seatId)!.assigned, true);
  assert.equal(os.seats.get('near-right')!.assigned, false);
  for (let frame = 0; frame < 30; frame++) os.update(0.1);
  for (const ch of [one, two]) {
    const seat = os.seats.get(ch.seatId!)!;
    assert.deepEqual([ch.tileCol, ch.tileRow], [seat.seatCol, seat.seatRow]);
    assert.equal(ch.parentAgentId, 1);
    assert.equal(ch.state, 'type');
  }
  assert.deepEqual(
    Object.keys(os.getPersistableSeats()),
    ['1'],
    'sub-agent seat reservations must remain transient',
  );
});

test('a full parent Area uses an in-area tile instead of borrowing another Area seat', () => {
  const layout = splitAreaLayout();
  const os = new OfficeState(layout);
  os.seats.set('lead', seatAt('lead', 3, 3));
  os.seats.set('only-left', seatAt('only-left', 1, 1));
  os.seats.set('right', seatAt('right', 4, 3));
  os.addAgent(1, 0, 0, 'lead');
  const seated = os.characters.get(os.addSubagent(1, 'nested-one'))!;
  const overflow = os.characters.get(os.addSubagent(1, 'nested-two'))!;
  assert.equal(seated.seatId, 'only-left');
  assert.equal(overflow.seatId, null);
  assert.equal(areaLabelAt(layout, overflow.tileCol, overflow.tileRow), 'left');
  assert.equal(os.seats.get('right')!.assigned, false);
});

test('completion releases reserved sub-agent seats and lead removal releases the remaining ones', () => {
  const os = new OfficeState(splitAreaLayout());
  os.seats.set('lead', seatAt('lead', 3, 3));
  os.seats.set('left-a', seatAt('left-a', 0, 1));
  os.seats.set('left-b', seatAt('left-b', 1, 1));
  os.addAgent(1, 0, 0, 'lead');
  const first = os.addSubagent(1, 'nested-one');
  os.addSubagent(1, 'nested-two');
  const freed = os.characters.get(first)!.seatId;
  assert.ok(freed);
  os.removeSubagent(1, 'nested-one');
  assert.equal(os.seats.get(freed)!.assigned, false);
  const replacement = os.addSubagent(1, 'nested-three');
  assert.equal(os.characters.get(replacement)!.seatId, freed);
  os.removeAllSubagents(1);
  assert.equal(os.seats.get('left-a')!.assigned, false);
  assert.equal(os.seats.get('left-b')!.assigned, false);
  assert.equal(os.seats.get('lead')!.assigned, true);
  assert.equal(os.subagentMeta.size, 0);
});
