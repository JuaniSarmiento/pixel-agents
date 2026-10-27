import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import { readClaudeProcesses, resolveLiveClaudeSessions } from '../src/claudeProcesses.js';

describe.skipIf(process.platform === 'win32')('Claude process inspection', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-proc-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function processEntry(pid: string, args: string[], cwd = '/work/videos'): void {
    const dir = path.join(root, pid);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'cmdline'), args.join('\0') + '\0');
    fs.symlinkSync(cwd, path.join(dir, 'cwd'), 'dir');
  }

  it('reads the cwd and explicit resumed session from native Claude', () => {
    processEntry('123', ['/home/juani/.local/bin/claude', '--resume', 'older-session']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([
      { cwd: '/work/videos', sessionId: 'older-session' },
    ]);
  });

  it('recognizes node CLI entrypoints and --resume= syntax', () => {
    processEntry('123', ['/usr/bin/node', '/usr/bin/claude', '--resume=older-session']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([
      { cwd: '/work/videos', sessionId: 'older-session' },
    ]);
  });

  it.each([['-r', 'session-id'], ['--session-id', 'session-id'], ['--session-id=session-id']])(
    'reads session flags %j',
    (...args) => {
      processEntry('123', ['claude', ...args]);
      expect(readClaudeProcesses(root, 'linux')).toEqual([
        { cwd: '/work/videos', sessionId: 'session-id' },
      ]);
    },
  );

  it('treats bare --resume followed by a flag as an unidentified process', () => {
    processEntry('123', ['claude', '--resume', '--verbose']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([
      { cwd: '/work/videos', sessionId: undefined },
    ]);
  });

  it('recognizes the official npm package cli.js entrypoint, but not arbitrary cli.js', () => {
    processEntry('123', [
      '/usr/bin/node',
      '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      '--resume',
      'session-id',
    ]);
    processEntry('456', ['/usr/bin/node', '/work/other-package/cli.js']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([
      { cwd: '/work/videos', sessionId: 'session-id' },
    ]);
  });

  it('does not treat an incidental claude argument as a process', () => {
    processEntry('123', ['/usr/bin/node', '/work/app.js', 'claude']);
    processEntry('456', ['/bin/echo', 'claude', '--resume', 'session']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([]);
  });

  it('ignores exited, zombie, non-PID and unreadable processes', () => {
    processEntry('123', ['claude']);
    fs.unlinkSync(path.join(root, '123', 'cwd'));
    processEntry('456', []);
    processEntry('not-a-pid', ['claude']);
    expect(readClaudeProcesses(root, 'linux')).toEqual([]);
  });

  it.each(['darwin', 'win32'] as const)('uses a safe fallback on %s', (platform) => {
    expect(readClaudeProcesses(root, platform)).toBeNull();
  });

  it('uses a safe fallback when procfs itself is unavailable', () => {
    expect(readClaudeProcesses(path.join(root, 'missing'), 'linux')).toBeNull();
  });

  it('falls back to the newest transcript when a resume argument cannot resolve a session', () => {
    const projectDir = path.join(root, normalizeProjectPath('/work/videos'));
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'newest.jsonl'), '');
    const files = resolveLiveClaudeSessions(projectDir, [
      { cwd: '/work/videos', sessionId: 'missing' },
    ]);
    expect(files.has(path.join(projectDir, 'newest.jsonl'))).toBe(true);
  });

  it('assigns different newest transcripts to multiple unidentified processes', () => {
    const projectDir = path.join(root, normalizeProjectPath('/work/videos'));
    fs.mkdirSync(projectDir);
    for (const session of ['a', 'b', 'c'])
      fs.writeFileSync(path.join(projectDir, `${session}.jsonl`), '');
    const a = path.join(projectDir, 'a.jsonl');
    fs.utimesSync(a, new Date(1), new Date(1));
    const files = resolveLiveClaudeSessions(projectDir, [
      { cwd: '/work/videos' },
      { cwd: '/work/videos' },
    ]);
    expect([...files].sort()).toEqual([
      path.join(projectDir, 'b.jsonl'),
      path.join(projectDir, 'c.jsonl'),
    ]);
  });
});
