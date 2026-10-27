/** Linux process evidence for Claude session discovery. No process is launched or killed. */
import * as fs from 'fs';
import * as path from 'path';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';

export interface ClaudeProcess {
  cwd: string;
  sessionId?: string;
}

/** null means process inspection is unavailable: callers retain their old policy. */
export function readClaudeProcesses(
  procRoot = '/proc',
  platform: NodeJS.Platform = process.platform,
): ClaudeProcess[] | null {
  if (platform !== 'linux') return null;
  let pids: string[];
  try {
    pids = fs.readdirSync(procRoot).filter((entry) => /^\d+$/.test(entry));
  } catch {
    return null;
  }
  const processes: ClaudeProcess[] = [];
  for (const pid of pids) {
    try {
      const dir = path.join(procRoot, pid);
      const args = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      if (args.length === 0) continue; // exited/zombie
      const command = path.basename(args[0]);
      const isClaude =
        command === 'claude' ||
        (['node', 'nodejs', 'bun'].includes(command) &&
          (['claude', 'claude.js'].includes(path.basename(args[1] ?? '')) ||
            (args[1] ?? '').endsWith('/@anthropic-ai/claude-code/cli.js')));
      if (!isClaude) continue;
      const cwd = fs.readlinkSync(path.join(dir, 'cwd'));
      const idFlag = args.findIndex(
        (arg) => arg === '--resume' || arg === '-r' || arg === '--session-id',
      );
      const nextArg = idFlag >= 0 ? args[idFlag + 1] : undefined;
      const equalsId = args
        .find((arg) => arg.startsWith('--resume=') || arg.startsWith('--session-id='))
        ?.split('=')[1];
      const sessionId = equalsId || (nextArg && !nextArg.startsWith('-') ? nextArg : undefined);
      processes.push({ cwd, sessionId });
    } catch {
      // Processes may exit between enumeration and reading cwd/cmdline, or belong to another user.
    }
  }
  return processes;
}

/** One unidentified process claims one newest transcript, never every session in its project. */
export function resolveLiveClaudeSessions(
  projectDir: string,
  processes: ClaudeProcess[],
): Set<string> {
  const matching = processes.filter(
    (p) => normalizeProjectPath(p.cwd) === path.basename(projectDir),
  );
  const sessions = new Set<string>();
  if (matching.length === 0) return sessions;
  let unidentified = 0;
  for (const proc of matching) {
    const candidate =
      proc.sessionId && path.basename(proc.sessionId) === proc.sessionId
        ? path.join(projectDir, `${proc.sessionId}.jsonl`)
        : undefined;
    try {
      if (candidate && fs.statSync(candidate).isFile()) {
        sessions.add(candidate);
        continue;
      }
    } catch {
      // A resume name or missing transcript cannot identify a session; try the newest in this cwd.
    }
    unidentified++;
  }
  if (unidentified === 0) return sessions;
  try {
    const candidates = fs
      .readdirSync(projectDir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => {
        const fullPath = path.join(projectDir, file);
        try {
          return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
        } catch {
          return { fullPath, mtime: -Infinity };
        }
      })
      .filter((file) => file.mtime !== -Infinity && !sessions.has(file.fullPath))
      .sort((a, b) => b.mtime - a.mtime || a.fullPath.localeCompare(b.fullPath));
    for (const file of candidates.slice(0, unidentified)) sessions.add(file.fullPath);
  } catch {
    // Project directory may disappear during a scan.
  }
  return sessions;
}
