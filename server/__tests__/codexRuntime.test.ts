vi.mock('../src/directories.js', () => ({ directoryNameForLaunch: () => undefined }));

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  scanCodexSessions,
  setAgentRemovalCallback,
  setDirectoryNameResolver,
  setDismissalTracker,
} from '../src/fileWatcher.js';
import { processTranscriptLine } from '../src/transcriptParser.js';

const timers = new Map<number, ReturnType<typeof setInterval>>();
const waiting = new Map<number, ReturnType<typeof setTimeout>>();
const permissions = new Map<number, ReturnType<typeof setTimeout>>();
let temp = '';
afterEach(() => {
  for (const timer of timers.values()) clearInterval(timer);
  for (const timer of waiting.values()) clearTimeout(timer);
  for (const timer of permissions.values()) clearTimeout(timer);
  timers.clear();
  waiting.clear();
  permissions.clear();
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Codex runtime adoption', () => {
  it('does not persist derived Codex characters for Claude restoration', () => {
    const agents = new AgentStateStore();
    const saveAgents = vi.fn();
    agents.setAdapter({
      saveAgents,
      loadAgents: () => [],
      loadSeats: () => ({}),
      saveSeats: () => {},
      getSetting: <T>(_key: string, fallback: T) => fallback,
      setSetting: () => {},
    } as StateAdapter);
    agents.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'one',
        projectDir: '/tmp',
        jsonlFile: '/tmp/one.jsonl',
        isExternal: true,
        providerId: 'codex',
      }),
    );
    agents.persist();
    expect(saveAgents).toHaveBeenCalledWith([]);
  });

  it('recovers the current status when attaching to an existing Codex session', () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runtime-'));
    const file = path.join(temp, 'rollout-existing.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'old',
          arguments: '{"cmd":"npm test"}',
        },
      }) + '\n',
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    const agents = new AgentStateStore();
    setDismissalTracker(new DismissalTracker());
    scanCodexSessions(
      [{ filePath: file, cwd: '/work/project', sessionId: 'one', mtimeMs: Date.now() }],
      new Set(),
      { current: 1 },
      agents,
      new Map(),
      timers,
      waiting,
      permissions,
      () => {},
    );
    expect([...agents.values()][0].activeToolStatuses.get('old')).toContain('npm test');
  });

  it('adopts a live session in its configured directory, displays its tool and removes it after exit', () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runtime-'));
    const file = path.join(temp, 'rollout-one.jsonl');
    fs.writeFileSync(file, '');
    const agents = new AgentStateStore();
    const messages: Record<string, unknown>[] = [];
    agents.on('broadcast', (message) => messages.push(message));
    setDismissalTracker(new DismissalTracker());
    setDirectoryNameResolver(({ cwd }) => (cwd === '/work/project' ? 'Project' : undefined));
    setAgentRemovalCallback((id) => {
      agents.delete(id);
    });
    const known = new Set<string>();
    const args = [
      known,
      { current: 1 },
      agents,
      new Map(),
      timers,
      waiting,
      permissions,
      () => {},
    ] as const;
    scanCodexSessions(
      [{ filePath: file, cwd: '/work/project', sessionId: 'one', mtimeMs: Date.now() }],
      ...args,
    );
    const agent = [...agents.values()][0];
    expect(agent).toMatchObject({ providerId: 'codex', directoryName: 'Project', jsonlFile: file });
    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-1',
          arguments: '{"cmd":"npm test"}',
        },
      }),
      agents,
      waiting,
      permissions,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'agentToolStart',
        id: agent.id,
        toolId: 'call-1',
        status: expect.stringContaining('npm test'),
      }),
    );
    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call-1', output: 'ok' },
      }),
      agents,
      waiting,
      permissions,
    );
    expect(agent.activeToolIds.has('call-1')).toBe(false);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentToolDone', toolId: 'call-1' }),
    );
    processTranscriptLine(
      agent.id,
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
      agents,
      waiting,
      permissions,
    );
    expect(agent.isWaiting).toBe(true);
    scanCodexSessions(
      [{ filePath: file, cwd: '/work/project', sessionId: 'one', mtimeMs: Date.now() }],
      ...args,
    );
    expect(agents.size).toBe(1);
    scanCodexSessions([], ...args);
    expect(agents.size).toBe(0);
    expect(known.has(file)).toBe(false);
  });
});
