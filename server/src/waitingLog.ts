import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Append-only JSONL log of "waiting for the human" transitions: a permission
 * prompt, or an idle turn end that's actually waiting on user input
 * (Notification(idle_prompt) / AskUserQuestion). An external notifier (e.g. a
 * WhatsApp bot run by a scheduled job) tails this file to ping the human --
 * this module only logs, it never sends anything itself.
 *
 * One line per event: `{ ts, sessionId, directoryName, motivo }`.
 */

export type WaitingReason = 'permission' | 'awaitingInput';

export interface WaitingEvent {
  /** ISO-8601 timestamp of the transition. */
  ts: string;
  sessionId: string;
  /** The agent's origin label, when known (only set for multi-root workspaces). */
  directoryName?: string;
  motivo: WaitingReason;
}

const DEFAULT_WAITING_LOG_PATH = path.join(os.homedir(), '.pixel-agents', 'esperando.jsonl');

/** Overridable in tests; mirrors the setHookProvider/setPaletteCount
 *  module-level setter pattern used elsewhere in this package. */
let waitingLogPath = DEFAULT_WAITING_LOG_PATH;

export function setWaitingLogPath(filePath: string): void {
  waitingLogPath = filePath;
}

export function resetWaitingLogPath(): void {
  waitingLogPath = DEFAULT_WAITING_LOG_PATH;
}

export function getWaitingLogPath(): string {
  return waitingLogPath;
}

/**
 * Append one "waiting for the human" event. Never throws -- a logging
 * failure (disk full, permissions, missing home dir) must never interrupt
 * hook event handling for the sake of a notification side channel.
 */
export function logWaitingForHuman(
  sessionId: string,
  directoryName: string | undefined,
  motivo: WaitingReason,
): void {
  try {
    fs.mkdirSync(path.dirname(waitingLogPath), { recursive: true });
    const event: WaitingEvent = {
      ts: new Date().toISOString(),
      sessionId,
      directoryName,
      motivo,
    };
    fs.appendFileSync(waitingLogPath, JSON.stringify(event) + '\n');
  } catch {
    /* never crash the hook pipeline over a logging failure */
  }
}
