/**
 * The "waiting for a human" bubble (permission prompt, or idle while
 * genuinely awaiting input) must stay up -- visibly -- until the session
 * actually moves again, not fade out on its own after a couple of seconds
 * like the plain "done" checkmark. See officeState.update()'s bubble-timer
 * tick and setAgentActive() for where that's enforced.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { WAITING_BUBBLE_DURATION_SEC } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function blankLayout(cols: number, rows: number): OfficeLayout {
  const tiles = new Array<TileType>(cols * rows).fill(TileType.FLOOR_1);
  return { version: 1, cols, rows, tiles, furniture: [] };
}

test('a plain "done" waiting bubble (not awaiting input) fades out on its own', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);
  os.showWaitingBubble(1, false);

  for (let i = 0; i < 50; i++) os.update(0.1); // well past WAITING_BUBBLE_DURATION_SEC

  const ch = os.characters.get(1)!;
  assert.equal(ch.bubbleType, null);
});

test('an "awaiting input" bubble does NOT fade out on its own, however long it waits', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);
  os.showWaitingBubble(1, true);

  for (let i = 0; i < 600; i++) os.update(0.5); // 300 simulated seconds

  const ch = os.characters.get(1)!;
  assert.equal(ch.bubbleType, 'waiting');
  assert.equal(ch.waitingAwaitingInput, true);
});

test('the awaiting-input bubble clears the moment the agent becomes active again', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);
  os.showWaitingBubble(1, true);
  for (let i = 0; i < 20; i++) os.update(1); // long past the old 2s auto-fade

  os.setAgentActive(1, true); // "session moved again" signal

  const ch = os.characters.get(1)!;
  assert.equal(ch.bubbleType, null);
  assert.equal(ch.waitingAwaitingInput, false);
});

test('clicking (dismissBubble) acknowledges an awaiting-input bubble immediately', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);
  os.showWaitingBubble(1, true);

  os.dismissBubble(1);

  const ch = os.characters.get(1)!;
  assert.equal(ch.bubbleType, null);
});

test('sanity: the plain-done bubble still respects its documented duration', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);
  os.update(1); // let the spawn matrix effect finish before timing the bubble
  os.showWaitingBubble(1, false);

  // Just before the duration elapses, the bubble is still up.
  os.update(WAITING_BUBBLE_DURATION_SEC - 0.5);
  assert.equal(os.characters.get(1)!.bubbleType, 'waiting');

  os.update(1);
  assert.equal(os.characters.get(1)!.bubbleType, null);
});
