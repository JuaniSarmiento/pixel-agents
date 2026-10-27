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

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { HookProvider } from '../../core/src/provider.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import * as claudeProcesses from '../src/claudeProcesses.js';
import {
  EXTERNAL_STALE_CHECK_INTERVAL_MS,
  GLOBAL_SCAN_ACTIVE_MAX_AGE_MS,
  GLOBAL_SCAN_ACTIVE_MIN_SIZE,
} from '../src/constants.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  scanExternalDir,
  scanGlobalProjectDirs,
  setAgentRemovalCallback,
  setDismissalTracker,
  setHookProvider,
  startStaleExternalAgentCheck,
} from '../src/fileWatcher.js';

describe('scanGlobalProjectDirs: process liveness and recent activity', () => {
  let rootDir: string;
  let projectDir: string;
  let knownJsonlFiles: Set<string>;
  let nextAgentIdRef: { current: number };
  let agents: AgentStateStore;
  let fileWatchers: Map<number, fs.FSWatcher>;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  function writeSessionFile(mtimeMsAgo: number, sessionId = 'sess-1'): string {
    const content = '{"type":"assistant"}\n'.padEnd(GLOBAL_SCAN_ACTIVE_MIN_SIZE + 1, ' ');
    const file = path.join(projectDir, `${sessionId}.jsonl`);
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
    projectDir = path.join(rootDir, normalizeProjectPath('/work/videos'));
    fs.mkdirSync(projectDir);
    vi.spyOn(claudeProcesses, 'readClaudeProcesses').mockReturnValue([]);
    setDismissalTracker(new DismissalTracker());

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
    setAgentRemovalCallback(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const t of pollingTimers.values()) clearInterval(t);
    for (const t of waitingTimers.values()) clearTimeout(t);
    for (const t of permissionTimers.values()) clearTimeout(t);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('skips a session quiet for 2 hours when no Claude process is alive in its project', () => {
    writeSessionFile(2 * 60 * 60 * 1000); // 2h old
    runGlobalScan();
    expect(agents.size).toBe(0);
  });

  it('still skips a session older than the (widened) adoption window', () => {
    writeSessionFile(GLOBAL_SCAN_ACTIVE_MAX_AGE_MS + 60 * 60 * 1000); // 1h past the window
    runGlobalScan();
    expect(agents.size).toBe(0);
  });
  it('adopts a recent session without a live process', () => {
    writeSessionFile(9 * 60 * 1000);
    runGlobalScan();
    expect(agents.size).toBe(1);
  });

  it('does not adopt an inactive session just beyond ten minutes', () => {
    writeSessionFile(10 * 60 * 1000 + 1000);
    runGlobalScan();
    expect(agents.size).toBe(0);
  });

  it('maps one live process to only the newest transcript, even older than 24h', () => {
    writeSessionFile(48 * 60 * 60 * 1000, 'old');
    const latest = writeSessionFile(25 * 60 * 60 * 1000, 'latest');
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([{ cwd: '/work/videos' }]);
    runGlobalScan();
    expect([...agents.values()].map((a) => a.jsonlFile)).toEqual([latest]);
  });

  it('uses the explicit resume id instead of the newest transcript', () => {
    const resumed = writeSessionFile(2 * 60 * 60 * 1000, 'resumed');
    writeSessionFile(60 * 60 * 1000, 'latest');
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([
      { cwd: '/work/videos', sessionId: 'resumed' },
    ]);
    runGlobalScan();
    expect([...agents.values()].map((a) => a.jsonlFile)).toEqual([resumed]);
  });

  it('does not borrow the live process of another project', () => {
    writeSessionFile(2 * 60 * 60 * 1000);
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([{ cwd: '/work/other' }]);
    runGlobalScan();
    expect(agents.size).toBe(0);
  });

  it('retains the old 24h adoption fallback without process inspection', () => {
    writeSessionFile(2 * 60 * 60 * 1000);
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue(null);
    runGlobalScan();
    expect(agents.size).toBe(1);
  });

  it('retains the 3KB minimum for recently active global transcripts', () => {
    const file = writeSessionFile(0);
    fs.truncateSync(file, GLOBAL_SCAN_ACTIVE_MIN_SIZE - 1);
    runGlobalScan();
    expect(agents.size).toBe(0);
  });

  it('keeps recently ended workspace sessions for ten minutes', () => {
    const file = writeSessionFile(9 * 60 * 1000);
    scanExternalDir(
      projectDir,
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      () => {},
    );
    expect([...agents.values()].map((a) => a.jsonlFile)).toEqual([file]);
  });

  it('does not adopt inactive workspace sessions without a live process', () => {
    writeSessionFile(2 * 60 * 60 * 1000);
    scanExternalDir(
      projectDir,
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      () => {},
    );
    expect(agents.size).toBe(0);
  });

  it('also adopts idle live sessions in workspace scanning', () => {
    const file = writeSessionFile(2 * 60 * 60 * 1000);
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([{ cwd: '/work/videos' }]);
    scanExternalDir(
      projectDir,
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      () => {},
    );
    expect([...agents.values()].map((a) => a.jsonlFile)).toEqual([file]);
  });

  it('removes an inactive agent after its process exits, even with hooks enabled, and allows re-adoption', () => {
    vi.useFakeTimers();
    const file = writeSessionFile(2 * 60 * 60 * 1000);
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([{ cwd: '/work/videos' }]);
    runGlobalScan();
    expect(agents.size).toBe(1);
    const remove = vi.fn((id: number) => agents.delete(id));
    setAgentRemovalCallback(remove);
    const timer = startStaleExternalAgentCheck(agents, knownJsonlFiles, { current: true });
    try {
      vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
      expect(remove).not.toHaveBeenCalled();
      vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue([]);
      vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
      expect(remove).toHaveBeenCalledWith(1);
      expect(agents.size).toBe(0);
      expect(knownJsonlFiles.has(file)).toBe(false);
      fs.utimesSync(file, new Date(), new Date());
      runGlobalScan();
      expect(agents.size).toBe(1);
    } finally {
      clearInterval(timer);
    }
  });

  it('keeps recently ended sessions until their ten minute grace period expires', () => {
    vi.useFakeTimers();
    const file = writeSessionFile(9 * 60 * 1000);
    runGlobalScan();
    setAgentRemovalCallback((id) => agents.delete(id));
    const timer = startStaleExternalAgentCheck(agents, knownJsonlFiles, { current: false });
    try {
      vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
      expect(agents.size).toBe(1);
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(agents.size).toBe(0);
      expect(knownJsonlFiles.has(file)).toBe(false);
    } finally {
      clearInterval(timer);
    }
  });

  it('keeps the previous cleanup behavior when process inspection is unavailable', () => {
    vi.useFakeTimers();
    const file = writeSessionFile(2 * 60 * 60 * 1000);
    agents.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'sess-1',
        isExternal: true,
        projectDir,
        jsonlFile: file,
      }),
    );
    vi.mocked(claudeProcesses.readClaudeProcesses).mockReturnValue(null);
    setAgentRemovalCallback((id) => agents.delete(id));
    const timer = startStaleExternalAgentCheck(agents, knownJsonlFiles, { current: false });
    try {
      vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
      expect(agents.size).toBe(1);
      fs.unlinkSync(file);
      vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
      expect(agents.size).toBe(0);
    } finally {
      clearInterval(timer);
    }
  });
});
