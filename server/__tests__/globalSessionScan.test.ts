import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; the 'vscode'
// package only resolves inside the extension host. Stub the two APIs fileWatcher actually
// touches at runtime (vscode.window.activeTerminal / terminals) so the module loads
// under vitest. Must be declared BEFORE the fileWatcher import.
import { vi } from 'vitest';
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import type { HookProvider } from '../../core/src/provider.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { GLOBAL_SCAN_ACTIVE_MAX_AGE_MS, GLOBAL_SCAN_ACTIVE_MIN_SIZE } from '../src/constants.js';
import { scanGlobalProjectDirs, setHookProvider } from '../src/fileWatcher.js';

/**
 * The "Watch All Sessions" global scanner only adopted JSONL files modified
 * within the last 10 minutes (GLOBAL_SCAN_ACTIVE_MAX_AGE_MS), so a session
 * left open but quiet for longer than that — the exact case the feature
 * exists to surface — silently vanished from the scan. The window widened to
 * 24h; the size filter (GLOBAL_SCAN_ACTIVE_MIN_SIZE) is untouched.
 */
describe('scanGlobalProjectDirs: adoption age window', () => {
  let rootDir: string;
  let projectDir: string;
  let knownJsonlFiles: Set<string>;
  let nextAgentIdRef: { current: number };
  let agents: AgentStateStore;
  let fileWatchers: Map<number, fs.FSWatcher>;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  function writeSessionFile(mtimeMsAgo: number): string {
    const content = '{"type":"assistant"}\n'.padEnd(GLOBAL_SCAN_ACTIVE_MIN_SIZE + 1, ' ');
    const file = path.join(projectDir, 'sess-1.jsonl');
    fs.writeFileSync(file, content);
    const mtime = new Date(Date.now() - mtimeMsAgo);
    fs.utimesSync(file, mtime, mtime);
    return file;
  }

  function runGlobalScan(): void {
    scanGlobalProjectDirs(
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      () => {},
    );
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-global-scan-'));
    projectDir = fs.mkdtempSync(path.join(rootDir, 'proj-'));

    setHookProvider({
      getAllSessionRoots: () => [rootDir],
    } as unknown as HookProvider);

    knownJsonlFiles = new Set();
    nextAgentIdRef = { current: 1 };
    agents = new AgentStateStore();
    fileWatchers = new Map();
    pollingTimers = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  afterEach(() => {
    for (const t of pollingTimers.values()) clearInterval(t);
    for (const t of waitingTimers.values()) clearTimeout(t);
    for (const t of permissionTimers.values()) clearTimeout(t);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('adopts a session quiet for 2 hours — open but idle, not the first 10 minutes', () => {
    writeSessionFile(2 * 60 * 60 * 1000); // 2h old
    runGlobalScan();
    expect(agents.size).toBe(1);
  });

  it('still skips a session older than the (widened) adoption window', () => {
    writeSessionFile(GLOBAL_SCAN_ACTIVE_MAX_AGE_MS + 60 * 60 * 1000); // 1h past the window
    runGlobalScan();
    expect(agents.size).toBe(0);
  });
});
