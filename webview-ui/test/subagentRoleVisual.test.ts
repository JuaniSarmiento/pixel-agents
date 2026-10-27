/**
 * Sub-agents the orchestrator launches (role-dba, role-qa, "Rompedor"
 * descriptions, ...) get a FIXED visual identity: same role, same hue shift,
 * every time -- instead of inheriting whatever color the parent happens to
 * wear. See core/src/roles.ts for the detection/visual tables this exercises
 * indirectly through addSubagent's `role` parameter.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { ROLE_VISUALS } from '../../core/src/roles.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function blankLayout(cols: number, rows: number): OfficeLayout {
  const tiles = new Array<TileType>(cols * rows).fill(TileType.FLOOR_1);
  return { version: 1, cols, rows, tiles, furniture: [] };
}

test("a sub-agent with a detected role wears that role's fixed hue shift, not the parent's", () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 7, 10); // parent's own (random-diversity) palette/hueShift

  const subId = os.addSubagent(1, 'tool-1', 'dba');
  const sub = os.characters.get(subId)!;

  assert.equal(sub.hueShift, ROLE_VISUALS.dba.hueShift);
  assert.equal(sub.role, 'dba');
});

test('two sub-agents with the same role always get the identical hue shift', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 2, 90);
  os.addAgent(2, 5, 200);

  const first = os.characters.get(os.addSubagent(1, 'tool-1', 'qa'))!;
  const second = os.characters.get(os.addSubagent(2, 'tool-2', 'qa'))!;

  assert.equal(first.hueShift, second.hueShift);
  assert.equal(first.hueShift, ROLE_VISUALS.qa.hueShift);
});

test('different roles get visually distinct hue shifts', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 0, 0);

  const dba = os.characters.get(os.addSubagent(1, 'tool-1', 'dba'))!;
  const auditor = os.characters.get(os.addSubagent(1, 'tool-2', 'auditor'))!;

  assert.notEqual(dba.hueShift, auditor.hueShift);
});

test('no role detected -> sub-agent falls back to inheriting the parent appearance', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 3, 123);

  const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;

  assert.equal(sub.hueShift, 123);
  assert.equal(sub.role, undefined);
});

test('an unrecognized role string is ignored, same as no role at all', () => {
  const os = new OfficeState(blankLayout(9, 7));
  os.addAgent(1, 3, 77);

  const sub = os.characters.get(os.addSubagent(1, 'tool-1', 'not-a-real-role'))!;

  assert.equal(sub.hueShift, 77);
  assert.equal(sub.role, undefined);
});
