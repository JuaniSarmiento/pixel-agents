import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import * as claudeProcesses from '../src/claudeProcesses.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { PersistedAgent } from '../src/types.js';

function createMockAdapter(initial: PersistedAgent[] = []): StateAdapter & {
  saved: PersistedAgent[][];
} {
  let current = initial;
  const saved: PersistedAgent[][] = [];
  return {
    saved,
    loadAgents: () => current,
    saveAgents: (agents) => {
      current = agents;
      saved.push(agents);
    },
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: <T>(_key: string, defaultValue: T): T => defaultValue,
    setSetting: vi.fn<(key: string, value: unknown) => void>(),
  };
}

/**
 * restoreExternalAgents() runs on EVERY webviewReady handshake (every
 * reconnect / page reload — clientMessageHandler.ts), not only once at
 * server boot. Between two runs of the server, the SAME session's jsonlFile
 * can end up live under a DIFFERENT agent id than whatever id a stale
 * ~/.pixel-agents/standalone-state.json snapshot still has on disk for it
 * (ids are assigned by scan order, which depends on directory iteration
 * order and which sessions existed at that particular boot).
 *
 * restoreExternalAgents()'s only duplicate guard is `this.store.has(p.id)`
 * — it checks whether THAT SPECIFIC id is already taken, never whether
 * `p.jsonlFile` is already tracked under some OTHER id. So a stale
 * persisted record for an already-live session mints a second character
 * for the same Claude session: the duplicate the user sees multiplying in
 * an office Area.
 */
describe('AgentRuntime.restoreExternalAgents -- does not duplicate an already-live session', () => {
  let tmpDir: string;
  let jsonlPath: string;
  let runtime: AgentRuntime | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-restore-dup-'));
    jsonlPath = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(jsonlPath, '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runtime?.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips a persisted record whose jsonlFile is already tracked under a different live id', () => {
    // Stale disk snapshot from a PREVIOUS boot: this session was agent id 5.
    const adapter = createMockAdapter([
      {
        id: 5,
        sessionId: 'sess-dup',
        terminalName: '',
        isExternal: true,
        jsonlFile: jsonlPath,
        projectDir: tmpDir,
        directoryName: 'Tutor y Moodle',
      },
    ]);
    const store = new AgentStateStore();
    store.setAdapter(adapter);

    // THIS boot's scanners already adopted the same jsonlFile under id 2
    // (a fresh nextAgentId sequence, independent of the old snapshot).
    const live = createAgentState({
      id: 2,
      sessionId: 'sess-dup',
      isExternal: true,
      projectDir: tmpDir,
      jsonlFile: jsonlPath,
      directoryName: 'Tutor y Moodle',
    });
    store.set(2, live);

    runtime = new AgentRuntime(store, claudeProvider);
    runtime.restoreExternalAgents();

    expect(store.size).toBe(1);
    expect(store.has(5)).toBe(false);
    expect(store.has(2)).toBe(true);
  });

  it('still restores a persisted record whose jsonlFile is NOT already live (no regression)', () => {
    const adapter = createMockAdapter([
      {
        id: 5,
        sessionId: 'sess-dup',
        terminalName: '',
        isExternal: true,
        jsonlFile: jsonlPath,
        projectDir: tmpDir,
      },
    ]);
    const store = new AgentStateStore();
    store.setAdapter(adapter);

    runtime = new AgentRuntime(store, claudeProvider);
    runtime.restoreExternalAgents();

    expect(store.size).toBe(1);
    expect(store.has(5)).toBe(true);
  });
  it('does not resurrect an inactive persisted session without a live process', () => {
    vi.spyOn(claudeProcesses, 'readClaudeProcesses').mockReturnValue([]);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(jsonlPath, old, old);
    const store = new AgentStateStore();
    store.setAdapter(
      createMockAdapter([
        {
          id: 5,
          sessionId: 'sess-dup',
          terminalName: '',
          isExternal: true,
          jsonlFile: jsonlPath,
          projectDir: tmpDir,
        },
      ]),
    );
    runtime = new AgentRuntime(store, claudeProvider);
    runtime.restoreExternalAgents();
    expect(store.size).toBe(0);
  });

  it('preserves restore fallback when process inspection is unavailable', () => {
    vi.spyOn(claudeProcesses, 'readClaudeProcesses').mockReturnValue(null);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(jsonlPath, old, old);
    const store = new AgentStateStore();
    store.setAdapter(
      createMockAdapter([
        {
          id: 5,
          sessionId: 'sess-dup',
          terminalName: '',
          isExternal: true,
          jsonlFile: jsonlPath,
          projectDir: tmpDir,
        },
      ]),
    );
    runtime = new AgentRuntime(store, claudeProvider);
    runtime.restoreExternalAgents();
    expect(store.has(5)).toBe(true);
  });
});
