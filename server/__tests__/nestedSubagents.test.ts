import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { PROJECT_SCAN_INTERVAL_MS } from '../src/constants.js';
import { scanAllTeammateFiles } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { processTranscriptLine } from '../src/transcriptParser.js';

const SESSION = 'visible-session';
const OUTER = 'toolu-outer';
const INNER = 'toolu-inner';
const work = (id = 'toolu-read') =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/nested.ts' } }],
    },
  });
const spawn = (id: string) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'Delegated work' } }],
    },
  });
const launched = (id: string) =>
  JSON.stringify({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content: 'Async agent launched successfully.' },
      ],
    },
  });
const completed = (id: string) =>
  JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content: `<task-notification><tool-use-id>${id}</tool-use-id></task-notification>`,
  });

describe('nested sub-agents and forks through the real runtime wiring', () => {
  let root: string;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let messages: Record<string, unknown>[];

  function seed(id: string, meta: Record<string, unknown>, lines: string[] = [work()]): string {
    const dir = path.join(root, SESSION, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `agent-${id}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fs.writeFileSync(file.replace('.jsonl', '.meta.json'), JSON.stringify(meta));
    return file;
  }
  function line(id: number, text: string): void {
    const source = store.has(id) ? store : runtime.subagentWatch.store;
    processTranscriptLine(id, text, source, runtime.waitingTimers, runtime.permissionTimers);
  }
  function scan(): void {
    scanAllTeammateFiles(
      store.nextAgentId,
      store,
      runtime.fileWatchers,
      runtime.pollingTimers,
      runtime.waitingTimers,
      runtime.permissionTimers,
      () => store.persist(),
    );
  }
  function startOuter(): void {
    line(1, spawn(OUTER));
    line(1, launched(OUTER));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-nested-'));
    store = new AgentStateStore();
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: SESSION,
        projectDir: root,
        jsonlFile: path.join(root, `${SESSION}.jsonl`),
        isExternal: true,
      }),
    );
    runtime = new AgentRuntime(store, claudeProvider);
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Record<string, unknown>));
  });
  afterEach(() => {
    runtime.dispose();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers a spawn from a shadow transcript under its visible lead, without promoting or persisting it', () => {
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    const child = seed('child', {
      agentType: 'general-purpose',
      parentAgentId: 'parent',
      toolUseId: INNER,
    });
    startOuter();
    expect(runtime.subagentWatch.isWatching(child)).toBe(true);
    expect(runtime.subagentWatch.store.size).toBe(2);
    expect(store.size).toBe(1);
    const childStart = messages.find(
      (m) => m.type === 'subagentToolStart' && m.toolId === 'toolu-read',
    );
    expect(childStart).toMatchObject({ id: 1 });
    expect(childStart?.parentToolId).not.toBe(OUTER);
    expect(messages.some((m) => typeof m.id === 'number' && m.id >= 1_000_000)).toBe(false);
  });

  it('retries a late nested sidecar in the fallback scan and removes the whole chain with its lead', () => {
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    startOuter();
    const child = seed('child', {
      agentType: 'general-purpose',
      parentAgentId: 'agent-parent',
      toolUseId: INNER,
    });
    scan();
    expect(runtime.subagentWatch.isWatching(child)).toBe(true);
    scan();
    expect(runtime.subagentWatch.store.size).toBe(2);
    runtime.removeAgent(1);
    expect(runtime.subagentWatch.store.size).toBe(0);
  });

  it('discovers a parentAgentId-only fork chain and rejects orphan/cyclic metadata', () => {
    const fork = seed('fork', { parentAgentId: SESSION });
    const child = seed('fork-child', { parentAgentId: 'fork' });
    const orphan = seed('orphan', { parentAgentId: 'missing' });
    const cycleA = seed('cycle-a', { parentAgentId: 'cycle-b' });
    const cycleB = seed('cycle-b', { parentAgentId: 'cycle-a' });
    scan();
    scan();
    expect(runtime.subagentWatch.isWatching(fork)).toBe(true);
    expect(runtime.subagentWatch.isWatching(child)).toBe(true);
    expect(runtime.subagentWatch.isWatching(orphan)).toBe(false);
    expect(runtime.subagentWatch.isWatching(cycleA)).toBe(false);
    expect(runtime.subagentWatch.isWatching(cycleB)).toBe(false);
    expect(store.size).toBe(1);
  });

  it('completes the nested spawn without removing its parent and cascades outer completion', () => {
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    const child = seed('child', {
      agentType: 'general-purpose',
      parentAgentId: 'parent',
      toolUseId: INNER,
    });
    startOuter();
    const parent = [...runtime.subagentWatch.store.values()].find((a) =>
      a.jsonlFile.endsWith('agent-parent.jsonl'),
    )!;
    expect(runtime.subagentWatch.isWatching(child)).toBe(true);
    const childKey = messages.find(
      (m) => m.type === 'subagentToolStart' && m.toolId === 'toolu-read',
    )?.parentToolId;
    line(parent.id, completed(INNER));
    expect(runtime.subagentWatch.isWatching(child)).toBe(false);
    expect(runtime.subagentWatch.store.has(parent.id)).toBe(true);
    expect(messages).toContainEqual({ type: 'subagentClear', id: 1, parentToolId: childKey });
    line(1, completed(OUTER));
    expect(runtime.subagentWatch.store.size).toBe(0);
  });
  it('keeps siblings with reused spawn ids distinct and completes only the right origin', () => {
    const outerTwo = 'toolu-outer-two';
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    seed('sibling-parent', { agentType: 'general-purpose', toolUseId: outerTwo }, [
      spawn(INNER),
      launched(INNER),
    ]);
    const first = seed(
      'child-one',
      { agentType: 'general-purpose', parentAgentId: 'parent', toolUseId: INNER },
      [work('read-one')],
    );
    const second = seed(
      'child-two',
      {
        agentType: 'general-purpose',
        parentAgentId: 'sibling-parent',
        toolUseId: INNER,
        name: 'still-a-sub-agent',
      },
      [work('read-two')],
    );
    startOuter();
    line(1, spawn(outerTwo));
    line(1, launched(outerTwo));
    const one = messages.find((m) => m.type === 'subagentToolStart' && m.toolId === 'read-one')!;
    const two = messages.find((m) => m.type === 'subagentToolStart' && m.toolId === 'read-two')!;
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one.parentToolId).not.toBe(two.parentToolId);
    expect(one.id).toBe(1);
    expect(two.id).toBe(1);
    expect(store.size).toBe(1);
    const parent = [...runtime.subagentWatch.store.values()].find((a) =>
      a.jsonlFile.endsWith('agent-parent.jsonl'),
    )!;
    line(parent.id, completed(INNER));
    expect(runtime.subagentWatch.isWatching(first)).toBe(false);
    expect(runtime.subagentWatch.isWatching(second)).toBe(true);
    line(1, completed(outerTwo));
    expect(runtime.subagentWatch.isWatching(second)).toBe(false);
  });

  it('keeps the entire chain out of persistence and session routing', () => {
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    seed('child', { agentType: 'general-purpose', parentAgentId: 'parent', toolUseId: INNER });
    const register = vi.spyOn(runtime, 'registerAgent');
    const save = vi.fn();
    store.setAdapter({
      loadAgents: () => [],
      saveAgents: save,
      loadSeats: () => ({}),
      saveSeats: () => {},
      getSetting: <T>(_key: string, value: T) => value,
      setSetting: () => {},
    });
    startOuter();
    store.persist();
    expect(register).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)![0]).toHaveLength(1);
    expect(save.mock.calls.at(-1)![0][0].id).toBe(1);
    register.mockRestore();
  });

  it('flattens three generations and cascades parent completion without orphaning a grandchild', () => {
    const deepest = 'toolu-deepest';
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    seed('child', { agentType: 'general-purpose', parentAgentId: 'parent', toolUseId: INNER }, [
      spawn(deepest),
      launched(deepest),
    ]);
    const grandchild = seed('grandchild', {
      agentType: 'general-purpose',
      parentAgentId: 'child',
      toolUseId: deepest,
    });
    startOuter();
    expect(runtime.subagentWatch.store.size).toBe(3);
    expect(runtime.subagentWatch.isWatching(grandchild)).toBe(true);
    expect(messages.filter((m) => m.type === 'subagentToolStart').every((m) => m.id === 1)).toBe(
      true,
    );
    line(1, completed(OUTER));
    expect(runtime.subagentWatch.store.size).toBe(0);
  });

  it('rejects inactive fork metadata and mismatched parent ids despite matching spawn ids', () => {
    const old = seed('old-fork', { parentAgentId: SESSION });
    const ago = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(old, ago, ago);
    const wrong = seed('wrong-parent', {
      agentType: 'general-purpose',
      parentAgentId: 'missing',
      toolUseId: OUTER,
    });
    startOuter();
    scan();
    expect(runtime.subagentWatch.isWatching(old)).toBe(false);
    expect(runtime.subagentWatch.isWatching(wrong)).toBe(false);
  });

  it('does not guess ownership when live sibling spawns reuse an id without parent metadata', () => {
    const outerTwo = 'toolu-outer-two';
    seed('parent', { agentType: 'general-purpose', toolUseId: OUTER }, [
      spawn(INNER),
      launched(INNER),
    ]);
    seed('sibling-parent', { agentType: 'general-purpose', toolUseId: outerTwo }, [
      spawn(INNER),
      launched(INNER),
    ]);
    startOuter();
    line(1, spawn(outerTwo));
    line(1, launched(outerTwo));
    const ambiguous = seed('ambiguous', { agentType: 'general-purpose', toolUseId: INNER });
    scan();
    expect(runtime.subagentWatch.isWatching(ambiguous)).toBe(false);
  });

  it('retires a watched metadata-only fork after its activity grace expires', () => {
    const fork = seed('fork', { parentAgentId: SESSION });
    scan();
    expect(runtime.subagentWatch.isWatching(fork)).toBe(true);
    const ago = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(fork, ago, ago);
    scan();
    expect(runtime.subagentWatch.isWatching(fork)).toBe(false);
  });
  it.each([true, false])(
    'periodic runtime caller discovers and expires forks with hooks=%s',
    (hooks) => {
      vi.useFakeTimers();
      runtime.hooksEnabled.current = hooks;
      runtime.startProjectScan(root);
      const fork = seed('fork', { parentAgentId: SESSION });
      vi.advanceTimersByTime(PROJECT_SCAN_INTERVAL_MS);
      expect(runtime.subagentWatch.isWatching(fork)).toBe(true);
      const ago = new Date(Date.now() - 11 * 60 * 1000);
      fs.utimesSync(fork, ago, ago);
      vi.advanceTimersByTime(PROJECT_SCAN_INTERVAL_MS);
      expect(runtime.subagentWatch.isWatching(fork)).toBe(false);
    },
  );
});
