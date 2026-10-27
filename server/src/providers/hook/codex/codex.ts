import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';

/** Rollouts can contain private conversation text; never log raw records. */
export function parseCodexTranscriptLine(line: string): AgentEvent | null {
  try {
    const record = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') return null;
    if (record.type === 'session_meta' && typeof payload.cwd === 'string') {
      return { kind: 'sessionStart', source: 'codex', cwd: payload.cwd };
    }
    if (record.type === 'event_msg') {
      if (payload.type === 'task_complete') return { kind: 'turnEnd', awaitingInput: true };
      if (payload.type === 'turn_aborted') return { kind: 'turnEnd' };
      if (payload.type === 'task_started') {
        return { kind: 'toolStart', toolId: 'codex-thinking', toolName: 'thinking' };
      }
    }
    if (record.type !== 'response_item') return null;
    if (payload.type === 'reasoning') {
      return { kind: 'toolStart', toolId: 'codex-thinking', toolName: 'thinking' };
    }
    if (typeof payload.call_id !== 'string' || !payload.call_id) return null;
    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      return { kind: 'toolEnd', toolId: payload.call_id };
    }
    if (
      (payload.type !== 'function_call' && payload.type !== 'custom_tool_call') ||
      typeof payload.name !== 'string'
    )
      return null;
    let input: unknown = {};
    if (payload.type === 'custom_tool_call' && typeof payload.input === 'string') {
      input = { patch: payload.input };
    } else if (typeof payload.arguments === 'string') {
      try {
        input = JSON.parse(payload.arguments);
      } catch {
        input = {};
      }
    }
    return { kind: 'toolStart', toolId: payload.call_id, toolName: payload.name, input };
  } catch {
    return null;
  }
}

function formatToolStatus(name: string, input?: unknown): string {
  const data = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (name === 'thinking') return 'Thinking';
  if (name === 'exec_command' || name === 'shell_command' || name === 'shell') {
    const command =
      typeof data.cmd === 'string'
        ? data.cmd
        : typeof data.command === 'string'
          ? data.command
          : '';
    const compact = command.replace(/\s+/g, ' ').trim();
    return compact
      ? `Running: ${compact.length > 48 ? `${compact.slice(0, 48)}…` : compact}`
      : 'Running command';
  }
  if (name === 'apply_patch') {
    const patch = typeof data.patch === 'string' ? data.patch : '';
    const file = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(patch)?.[1];
    return file ? `Editing ${path.basename(file)}` : 'Editing files';
  }
  return `Using ${name}`;
}

export const codexProvider: HookProvider = {
  kind: 'hook',
  id: 'codex',
  displayName: 'Codex',
  protocolVersion: 1,
  normalizeHookEvent: () => null,
  installHooks: async () => {},
  uninstallHooks: async () => {},
  areHooksInstalled: async () => true,
  consentDisclosure: () => ({ headline: 'Codex', disclosure: 'Codex sessions are read locally.' }),
  formatToolStatus,
  permissionExemptTools: new Set(),
  subagentToolNames: new Set(),
  readingTools: new Set(),
  getSessionDirs: () => [path.join(os.homedir(), '.codex', 'sessions')],
  getAllSessionRoots: () => [path.join(os.homedir(), '.codex', 'sessions')],
  sessionFilePattern: 'rollout-*.jsonl',
  parseTranscriptLine: parseCodexTranscriptLine,
};
