# Session liveness — implementation evidence

## EVIDENCE — constructor

Source tree starts at `3ec43bd` on `feat/oficina-juani`. Times below are local Argentina time (UTC−03:00), 2026-10-27. No server restart or personal configuration edit was performed.

Sources read: `CONTRIBUTING.md`, `CONTEXT.md`, `core/src/normalizeProjectPath.ts`, `core/src/provider.ts`, `server/src/fileWatcher.ts`, `server/src/constants.ts`, `server/src/agentRuntime.ts`, `server/src/agentState.ts`, `server/src/directorySuggestions.ts`, `server/src/providers/hook/claude/claude.ts`, `server/__tests__/globalSessionScan.test.ts`, `server/__tests__/fileWatcherDismissal.test.ts`, `server/__tests__/agentRuntime.restoreDuplicate.test.ts`, `server/vitest.config.ts`, `.husky/pre-commit`. No knowledge-base directory or numbered lessons was available.

Baseline: `npm run test:server -- globalSessionScan.test.ts fileWatcherDismissal.test.ts` at 13:35:08: **2 files, 25 tests passed**.

### RED — adoption

`npm run test:server -- globalSessionScan.test.ts` at 13:35:27, exit 1, against the original 24h adoption policy:

```text
FAIL skips a session quiet for 2 hours when no Claude process is alive in its project
AssertionError: expected 1 to be 0
__tests__/globalSessionScan.test.ts:89:25
Test Files 1 failed (1)
Tests 1 failed | 1 passed (2)
```

### GREEN — adoption, cleanup, workspace discovery

`npm run test:server -- globalSessionScan.test.ts fileWatcherDismissal.test.ts` at 13:36:58, exit 0:

```text
Test Files 2 passed (2)
Tests 36 passed (36)
```

The new cases exercise process exit with hooks enabled, recent-ended expiry, re-adoption after renewed activity, a process in another cwd, one process/two old transcripts, explicit resume selection, >24h live transcripts and fallback. Cleanup uses the existing runtime removal callback and clears known-file membership.

### RED — restore

`npm run test:server -- agentRuntime.restoreDuplicate.test.ts` at 13:37:10, exit 1, before adding restore's liveness gate:

```text
FAIL does not resurrect an inactive persisted session without a live process
AssertionError: expected 1 to be 0
__tests__/agentRuntime.restoreDuplicate.test.ts:130:24
Test Files 1 failed (1)
Tests 1 failed | 3 passed (4)
```

### RED — npm entrypoint and unresolved resume

`npm exec -w server -- vitest run __tests__/claudeProcesses.test.ts` at 13:38:53, exit 1, before extending recognition/resolution:

```text
FAIL recognizes the official npm package cli.js entrypoint, but not arbitrary cli.js
__tests__/claudeProcesses.test.ts:59:48
FAIL falls back to the newest transcript when a resume argument cannot resolve a session
AssertionError: expected false to be true
__tests__/claudeProcesses.test.ts:91:62
Test Files 1 failed (1)
Tests 2 failed | 12 passed (14)
```

### Mutants — asserted behavior actually fails

The code was not yet committed. Original files were copied to `/tmp/pixel-task1-constants.before-mutant.ts` and `/tmp/pixel-task1-processes.before-mutant.ts` before each mutation, then restored. No mutant remains in the tree.

1. Temporarily widened the Linux grace period:

```diff
-export const SESSION_RECENT_ACTIVITY_MS = 600_000; // 10 minutes
+export const SESSION_RECENT_ACTIVITY_MS = 86_400_000; // MUTANT: permit closed sessions for 24h
```

`npm run test:server -- globalSessionScan.test.ts -t 'skips a session quiet for 2 hours'` at 13:38:22, exit 1. The nested npm script consumed `-t`, so Vitest actually ran the entire file rather than only the intended case; the output below is for the whole file:

```text
AssertionError: expected 1 to be 0
__tests__/globalSessionScan.test.ts:246:27
Test Files 1 failed (1)
Tests 7 failed | 8 passed (15)
```

2. Temporarily accepted incidental `claude` arguments (two added lines):

```diff
-      if (!isClaude) continue;
+      // MUTANT: accept any process mentioning claude.
+      if (!isClaude && !args.includes('claude')) continue;
```

`npm exec -w server -- vitest run __tests__/claudeProcesses.test.ts -t 'incidental claude'` at 13:38:34, exit 1:

```text
FAIL does not treat an incidental claude argument as a process
AssertionError: expected [ { cwd: '/work/videos', ... }, ... ] to deeply equal []
__tests__/claudeProcesses.test.ts:59:48
Test Files 1 failed (1)
Tests 1 failed | 12 skipped (13)
```

### GREEN — final focused suite after reverting mutants

`npm run test:server -- globalSessionScan.test.ts fileWatcherDismissal.test.ts claudeProcesses.test.ts agentRuntime.restoreDuplicate.test.ts` at 13:39:03, exit 0:

```text
Test Files 4 passed (4)
Tests 56 passed (56)
```

`npm run check-types` at approximately 13:38:06, exit 0 (`tsc --noEmit && tsc --noEmit -p server/tsconfig.test.json`). This predates the npm-entrypoint and resume fallback refinement; the closing delivery must re-run typecheck on the delivered commit.

Final focused formatting/lint/type checks at 13:39:44, all exit 0:

```text
npx prettier --check server/src/claudeProcesses.ts server/src/fileWatcher.ts server/src/agentRuntime.ts server/src/constants.ts server/__tests__/globalSessionScan.test.ts server/__tests__/claudeProcesses.test.ts server/__tests__/agentRuntime.restoreDuplicate.test.ts
All matched files use Prettier code style!
npx eslint server/src/claudeProcesses.ts server/src/fileWatcher.ts server/src/agentRuntime.ts server/src/constants.ts server/__tests__/globalSessionScan.test.ts server/__tests__/claudeProcesses.test.ts server/__tests__/agentRuntime.restoreDuplicate.test.ts
(no diagnostics)
npm run check-types
tsc --noEmit && tsc --noEmit -p server/tsconfig.test.json
(no diagnostics)
```

## JUDGMENT — constructor

The change meets the requested Linux policy across global and workspace adoption, periodic cleanup (including hooks mode), and persisted-session restore. Compared against the request and existing external lifecycle APIs. Confidence: high for fixture-covered behavior. Process inspection is outside the 500ms transcript poll: once per scanner call/check and per restore; selected session sets are shared across agents in a project during cleanup/restore. Fallback retains global adoption's 24h window and the prior workspace/cleanup/restore behavior.

Review identity: constructor sub-agent dispatched by the same Codex parent; shared model family, no independent provider review claimed. No auditor dictated exact cases. Parent highlighted npm-entrypoint recognition and unresolved-resume fallback during implementation; these cases are therefore not independent convergence. No sibling reports were read. Reviewer tool restrictions were not enforced. No specialist review or auditor verdict is implied by this implementation report.

`CONTEXT.md` now states the Linux expiry policy instead of the superseded claim that age never removes an agent. The 3KB global-adoption minimum remains.

## ASSUMPTION — not verified on a running office

A live process without an exact existing resume/session id is associated with the newest unclaimed top-level transcript of the project encoded from `/proc/<pid>/cwd`. Multiple unidentified processes claim the corresponding number of newest transcripts. This is a heuristic, not proof of which idle process owns which transcript. `--resume` names or missing ids fall back to newest-in-cwd. No live UI walkthrough was performed and the running server on port 4310 was left alone. Non-Linux fallback is exercised by explicit platform arguments; the process-fixture tests are skipped on Windows because constructing directory symlinks may require extra privileges. The test runs here occurred on Linux.
