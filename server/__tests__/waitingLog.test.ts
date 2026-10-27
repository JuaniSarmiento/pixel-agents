import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getWaitingLogPath,
  logWaitingForHuman,
  resetWaitingLogPath,
  setWaitingLogPath,
} from '../src/waitingLog.js';

describe('waitingLog', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-waiting-log-'));
    logPath = path.join(dir, 'nested', 'esperando.jsonl');
    setWaitingLogPath(logPath);
  });

  afterEach(() => {
    resetWaitingLogPath();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the parent directory and appends a JSON line', () => {
    logWaitingForHuman('sess-1', 'my-project', 'permission');

    const lines = fs
      .readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event).toMatchObject({
      sessionId: 'sess-1',
      directoryName: 'my-project',
      motivo: 'permission',
    });
    expect(typeof event.ts).toBe('string');
    expect(new Date(event.ts).toString()).not.toBe('Invalid Date');
  });

  it('appends rather than overwriting on repeated calls', () => {
    logWaitingForHuman('sess-1', undefined, 'permission');
    logWaitingForHuman('sess-2', undefined, 'awaitingInput');

    const lines = fs
      .readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).sessionId).toBe('sess-1');
    expect(JSON.parse(lines[1]).sessionId).toBe('sess-2');
  });

  it('omits directoryName when not provided', () => {
    logWaitingForHuman('sess-1', undefined, 'awaitingInput');

    const event = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(event.directoryName).toBeUndefined();
    expect(event.motivo).toBe('awaitingInput');
  });

  it('never throws even when the path is unwritable', () => {
    // A path through a file (not a directory) can never be mkdir'd into.
    const blockerFile = path.join(dir, 'blocker');
    fs.writeFileSync(blockerFile, 'not a directory');
    setWaitingLogPath(path.join(blockerFile, 'esperando.jsonl'));

    expect(() => logWaitingForHuman('sess-1', undefined, 'permission')).not.toThrow();
  });

  it('getWaitingLogPath reflects the override', () => {
    expect(getWaitingLogPath()).toBe(logPath);
  });
});
