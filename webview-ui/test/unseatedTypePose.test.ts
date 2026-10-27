/**
 * A character with NO seat (`seatId === null`) that becomes active still
 * enters `CharacterState.TYPE` — characters.ts's "no seat assigned — type in
 * place" fallback (and `createCharacter`'s default state) — because the
 * sub-agent domain model (CONTEXT.md: "visualized with its own character
 * near its parent — around it, not in a seat") and the no-free-seat fallback
 * for top-level agents both rely on it to animate while working.
 *
 * Both the renderer (`renderer.ts`) and hit-testing (`officeState.ts
 * getCharacterAt`) applied `CHARACTER_SITTING_OFFSET_PX` whenever
 * `ch.state === CharacterState.TYPE`, with no regard for whether the
 * character actually HAS a seat. An unseated TYPE character was rendered
 * sunk 6px into the floor as if sitting in a chair that is not there — the
 * "character sitting on the floor" bug. The offset must apply only when the
 * character is seated for real.
 *
 * getCharacterAt is pure OfficeState domain logic (no canvas needed) and
 * shares the exact same bug: it is what turns "visually sunk 6px" into an
 * observable, testable fact (the click hit-box moves too).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { CHARACTER_SITTING_OFFSET_PX } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

const COLS = 9;
const ROWS = 7;

/** All-floor layout, no furniture, no seats at all. */
function floorLayout(): OfficeLayout {
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

test('an unseated character in TYPE state (no chair) is not hit-tested as sitting', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0); // no seats exist in this layout -> seatId stays null
  const ch = os.characters.get(1)!;

  assert.equal(ch.seatId, null, 'no seats in this layout, so the agent has none');
  assert.equal(ch.state, CharacterState.TYPE, 'starts in TYPE (typing/working pose)');

  // Probe a point inside the gap the (buggy) sitting offset would open up:
  // below the character's real feet anchor (ch.y) but still above where a
  // seated character's shifted-down hit-box bottom would sit.
  const probeY = ch.y + CHARACTER_SITTING_OFFSET_PX / 2;
  assert.equal(
    os.getCharacterAt(ch.x, probeY),
    null,
    'must not be hit-testable below its real feet when it has no seat',
  );
});

test('a seated character in TYPE state is still hit-tested with the sitting offset', () => {
  const layout = floorLayout();
  const os = new OfficeState(layout);
  os.seats.set('seat-1', {
    uid: 'seat-1',
    seatCol: 3,
    seatRow: 3,
    facingDir: Direction.DOWN,
    assigned: false,
  });
  os.addAgent(1, 0, 0, 'seat-1');
  const ch = os.characters.get(1)!;

  assert.equal(ch.seatId, 'seat-1');
  assert.equal(ch.state, CharacterState.TYPE);

  const probeY = ch.y + CHARACTER_SITTING_OFFSET_PX / 2;
  assert.equal(
    os.getCharacterAt(ch.x, probeY),
    1,
    'a genuinely seated character keeps the sitting-offset hit-box',
  );
});
