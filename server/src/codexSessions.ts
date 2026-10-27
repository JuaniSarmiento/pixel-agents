/** Read-only discovery of live Codex CLI rollouts on Linux. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CodexSession {
  filePath: string;
  cwd: string;
  sessionId: string;
  mtimeMs: number;
}

interface CodexProcess {
  cwd: string;
  sessionId?: string;
  pid: string;
  parentPid?: string;
  wrapper: boolean;
}

/** null indicates that process inspection is unavailable. */
function readProcesses(procRoot: string, platform: NodeJS.Platform): CodexProcess[] | null {
  if (platform !== 'linux') return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return null;
  }
  const processes: CodexProcess[] = [];
  for (const pid of entries.filter((entry) => /^\d+$/.test(entry))) {
    try {
      const dir = path.join(procRoot, pid);
      const args = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      const name = path.basename(args[0] ?? '');
      const script = path.basename(args[1] ?? '');
      if (
        name !== 'codex' &&
        !(['node', 'nodejs', 'bun'].includes(name) && (script === 'codex' || script === 'codex.js'))
      )
        continue;
      const cwd = fs.readlinkSync(path.join(dir, 'cwd'));
      const resume = args.indexOf('resume');
      const sessionId =
        resume >= 0
          ? args.slice(resume + 1).find((arg) => /^[\da-f]{8}-[\da-f-]{27,}$/i.test(arg))
          : undefined;
      let parentPid: string | undefined;
      try {
        parentPid = fs.readFileSync(path.join(dir, 'status'), 'utf8').match(/^PPid:\s*(\d+)/m)?.[1];
      } catch {
        // The process may exit between reads; missing parent information is not fatal.
      }
      processes.push({ cwd, sessionId, pid, parentPid, wrapper: name !== 'codex' });
    } catch {
      // A process can exit or become unreadable during enumeration.
    }
  }
  const nativeParents = new Set(processes.filter((p) => !p.wrapper).map((p) => p.parentPid));
  return processes.filter((p) => !p.wrapper || !nativeParents.has(p.pid));
}

/** Walk date directories, including old ones: resumed sessions stay at their original path. */
function recentRollouts(root: string, now: number): CodexSession[] {
  const sessions: CodexSession[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (depth < 3 && entry.isDirectory() && /^\d+$/.test(entry.name)) {
        walk(filePath, depth + 1);
      } else if (depth === 3 && entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 600_000) continue;
          // The first record contains metadata, never expose the remaining private transcript.
          const fd = fs.openSync(filePath, 'r');
          let line: string;
          try {
            const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
            const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
            const raw = buffer.toString('utf8', 0, bytes);
            const end = raw.indexOf('\n');
            if (end < 0) continue;
            line = raw.slice(0, end);
          } finally {
            fs.closeSync(fd);
          }
          const record = JSON.parse(line) as {
            type?: string;
            payload?: { cwd?: unknown; session_id?: unknown; id?: unknown };
          };
          const sessionId = record.payload?.session_id ?? record.payload?.id;
          if (
            record.type !== 'session_meta' ||
            typeof record.payload?.cwd !== 'string' ||
            typeof sessionId !== 'string'
          )
            continue;
          sessions.push({ filePath, cwd: record.payload.cwd, sessionId, mtimeMs: stat.mtimeMs });
        } catch {
          // Partial, malformed or disappearing files are retried on the next scan.
        }
      }
    }
  };
  walk(root, 0);
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
}

/** At most one recent rollout per process, matched by cwd and explicit resume ID where available. */
export function discoverCodexSessions(
  root = path.join(os.homedir(), '.codex', 'sessions'),
  procRoot = '/proc',
  now = Date.now(),
  platform: NodeJS.Platform = process.platform,
): CodexSession[] | null {
  const processes = readProcesses(procRoot, platform);
  if (processes === null) return null;
  if (!processes.length) return [];
  const candidates = recentRollouts(root, now);
  const selected: CodexSession[] = [];
  // Reserve explicitly identified sessions before allocating any by recency.
  processes.sort((a, b) => Number(Boolean(b.sessionId)) - Number(Boolean(a.sessionId)));
  for (const proc of processes) {
    const index = candidates.findIndex(
      (session) =>
        path.resolve(session.cwd) === path.resolve(proc.cwd) &&
        (!proc.sessionId || session.sessionId === proc.sessionId),
    );
    if (index >= 0) selected.push(...candidates.splice(index, 1));
  }
  return selected;
}
