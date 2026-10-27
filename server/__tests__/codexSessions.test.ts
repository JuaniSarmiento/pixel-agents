import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverCodexSessions } from '../src/codexSessions.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-discovery-'));
  dirs.push(dir);
  const root = path.join(dir, 'sessions');
  const proc = path.join(dir, 'proc');
  const cwd = path.join(dir, 'project');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(proc);
  const rollout = (id: string, mtime: number, project = cwd) => {
    const folder = path.join(root, '2025', '01', '01');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `rollout-${id}.jsonl`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ type: 'session_meta', payload: { id, cwd: project } })}\n`,
    );
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  const process = (pid: number, command = 'codex') => {
    const p = path.join(proc, String(pid));
    fs.mkdirSync(p);
    fs.writeFileSync(path.join(p, 'cmdline'), `${command}\0exec\0`);
    fs.symlinkSync(cwd, path.join(p, 'cwd'));
  };
  return { root, proc, cwd, rollout, process };
}

describe('Codex session discovery', () => {
  it('adopts only the newest recent session for each live process with matching cwd', () => {
    const f = fixture();
    const now = Math.floor(Date.now() / 1000) * 1000;
    f.rollout('older', now - 2000);
    const newest = f.rollout('newest', now - 1000);
    f.rollout('other-project', now - 500, '/unrelated');
    f.process(1);
    expect(discoverCodexSessions(f.root, f.proc, now, 'linux')).toEqual([
      { filePath: newest, cwd: f.cwd, sessionId: 'newest', mtimeMs: now - 1000 },
    ]);
  });

  it('counts a node launcher and its Codex child as one process', () => {
    const f = fixture();
    const now = Math.floor(Date.now() / 1000) * 1000;
    f.rollout('older', now - 2000);
    const newest = f.rollout('newest', now - 1000);
    f.process(10, 'node');
    fs.writeFileSync(path.join(f.proc, '10', 'cmdline'), 'node\0codex.js\0exec\0');
    f.process(11);
    fs.writeFileSync(path.join(f.proc, '11', 'status'), 'Name:\tcodex\nPPid:\t10\n');
    expect(discoverCodexSessions(f.root, f.proc, now, 'linux')).toEqual([
      { filePath: newest, cwd: f.cwd, sessionId: 'newest', mtimeMs: now - 1000 },
    ]);
  });

  it('excludes stale sessions and sessions without a live Codex process', () => {
    const f = fixture();
    const now = Math.floor(Date.now() / 1000) * 1000;
    f.rollout('old', now - 600_001);
    f.process(1);
    expect(discoverCodexSessions(f.root, f.proc, now, 'linux')).toEqual([]);
    f.rollout('recent', now - 1000);
    fs.rmSync(path.join(f.proc, '1'), { recursive: true });
    f.process(2, 'claude');
    expect(discoverCodexSessions(f.root, f.proc, now, 'linux')).toEqual([]);
    expect(discoverCodexSessions(f.root, f.proc, now, 'darwin')).toBeNull();
  });
});
