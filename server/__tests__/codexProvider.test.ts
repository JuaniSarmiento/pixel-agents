import { describe, expect, it } from 'vitest';

import { codexProvider } from '../src/providers/hook/codex/codex.js';

const line = (type: string, payload: unknown) => JSON.stringify({ type, payload });

describe('Codex transcript provider', () => {
  it('extracts session identity and turn boundaries without exposing messages', () => {
    expect(
      codexProvider.parseTranscriptLine!(line('session_meta', { id: 's1', cwd: '/project' })),
    ).toEqual({ kind: 'sessionStart', source: 'codex', cwd: '/project' });
    expect(codexProvider.parseTranscriptLine!(line('event_msg', { type: 'task_started' }))).toEqual(
      { kind: 'toolStart', toolId: 'codex-thinking', toolName: 'thinking' },
    );
    expect(
      codexProvider.parseTranscriptLine!(line('event_msg', { type: 'task_complete' })),
    ).toEqual({ kind: 'turnEnd', awaitingInput: true });
    expect(codexProvider.parseTranscriptLine!(line('event_msg', { type: 'turn_aborted' }))).toEqual(
      { kind: 'turnEnd' },
    );
    expect(
      codexProvider.parseTranscriptLine!(
        line('response_item', { type: 'message', content: 'private' }),
      ),
    ).toBeNull();
  });

  it('maps function calls and results and formats shell and patch activity', () => {
    const call = codexProvider.parseTranscriptLine!(
      line('response_item', {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'c1',
        arguments: '{"cmd":"npm test"}',
      }),
    );
    expect(call).toEqual({
      kind: 'toolStart',
      toolId: 'c1',
      toolName: 'exec_command',
      input: { cmd: 'npm test' },
    });
    expect(codexProvider.formatToolStatus('exec_command', { cmd: 'npm test' })).toBe(
      'Running: npm test',
    );
    expect(
      codexProvider.parseTranscriptLine!(
        line('response_item', { type: 'function_call_output', call_id: 'c1' }),
      ),
    ).toEqual({ kind: 'toolEnd', toolId: 'c1' });
    expect(
      codexProvider.parseTranscriptLine!(
        line('response_item', { type: 'custom_tool_call_output', call_id: 'c2' }),
      ),
    ).toEqual({ kind: 'toolEnd', toolId: 'c2' });
    const patch = codexProvider.parseTranscriptLine!(
      line('response_item', {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'c2',
        input: '*** Begin Patch\n*** Update File: src/example.ts\n',
      }),
    );
    expect(patch).toEqual({
      kind: 'toolStart',
      toolId: 'c2',
      toolName: 'apply_patch',
      input: { patch: '*** Begin Patch\n*** Update File: src/example.ts\n' },
    });
    expect(
      codexProvider.formatToolStatus('apply_patch', { patch: '*** Update File: src/example.ts\n' }),
    ).toBe('Editing example.ts');
  });

  it('ignores malformed and unrelated records safely', () => {
    expect(codexProvider.parseTranscriptLine!('{')).toBeNull();
    expect(
      codexProvider.parseTranscriptLine!(
        line('response_item', { type: 'function_call', name: 'exec_command' }),
      ),
    ).toBeNull();
    expect(
      codexProvider.parseTranscriptLine!(line('event_msg', { type: 'token_count' })),
    ).toBeNull();
  });
});
