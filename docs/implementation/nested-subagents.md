# Nested sub-agents and forks — implementation evidence

## EVIDENCE — constructor

Starting commit: `5023fb1` on `feat/oficina-juani`. All times below are 2026-10-27, local Argentina time (UTC−03:00). This report is the complete constructor return retained in the repository; the parent orchestrator receives the same facts. No commit, push, server restart, or personal configuration edit was performed by this constructor.

Sources read: `CONTRIBUTING.md`, `CONTEXT.md`, `core/src/teamProvider.ts`, `core/src/normalizeProjectPath.ts`, `server/src/agentRuntime.ts`, `server/src/fileWatcher.ts`, `server/src/subagentWatch.ts`, `server/src/transcriptParser.ts`, `server/src/agentStateStore.ts`, `server/src/providers/hook/claude/claudeTeamProvider.ts`, `server/__tests__/backgroundAgents.test.ts`, `server/__tests__/agentRuntime.test.ts`, `server/__tests__/claudeTeamProvider.test.ts`, `webview-ui/src/hooks/useExtensionMessages.ts`, `webview-ui/src/office/engine/officeState.ts`, `webview-ui/src/office/engine/characters.ts`, `webview-ui/src/office/engine/seatPlacement.ts`, `webview-ui/src/testHooks.ts`, and the corresponding seating tests. There is no knowledge base or numbered lesson file available in this repository.

### Baselines

`npm run test:server -- backgroundAgents.test.ts agentRuntime.test.ts claudeTeamProvider.test.ts` at 13:41:03, exit 0:

```text
Test Files 3 passed (3)
Tests 71 passed (71)
```

`npm exec -w webview-ui -- vitest run test/subagentAreaSeating.test.ts test/teammateSeating.test.ts` at 13:44:43, exit 0:

```text
Test Files 2 passed (2)
Tests 7 passed (7)
```

### RED — real runtime callbacks, retry, forks, completion

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts` at 13:43:34, exit 1, before modifying production discovery/watch code:

```text
FAIL discovers a spawn from a shadow transcript under its visible lead, without promoting or persisting it
FAIL retries a late nested sidecar in the fallback scan and removes the whole chain with its lead
FAIL discovers a parentAgentId-only fork chain and rejects orphan/cyclic metadata
FAIL completes the nested spawn without removing its parent and cascades outer completion
AssertionError: expected false to be true
__tests__/nestedSubagents.test.ts:103:53
Test Files 1 failed (1)
Tests 4 failed (4)
```

These tests construct an actual `AgentRuntime`, use its registered transcript callbacks and real temporary transcript/sidecar files, and observe the shadow/main stores and main-store broadcasts. They do not replace the scanner or runtime callback with a mock.

### GREEN — first backend implementation

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts __tests__/backgroundAgents.test.ts __tests__/claudeTeamProvider.test.ts __tests__/agentRuntime.test.ts` at 13:44:17, exit 0:

```text
Test Files 4 passed (4)
Tests 75 passed (75)
```

### RED — actual seats instead of free floor tiles

`npm exec -w webview-ui -- vitest run test/subagentAreaSeating.test.ts` at 13:45:22, exit 1, before modifying office placement:

```text
FAIL flattened descendants reserve distinct free seats in the visible lead Area and sit there
AssertionError: first descendant must own a seat
FAIL a full parent Area uses an in-area tile instead of borrowing another Area seat
AssertionError: expected null to equal 'only-left'
FAIL completion releases reserved sub-agent seats and lead removal releases the remaining ones
AssertionError: ok(freed), received null
test/subagentAreaSeating.test.ts:182:10
Test Files 1 failed (1)
Tests 3 failed | 3 passed (6)
```

### GREEN — seating and lifecycle

`npm exec -w webview-ui -- vitest run test/subagentAreaSeating.test.ts test/teammateSeating.test.ts` at 13:45:39, exit 0:

```text
Test Files 2 passed (2)
Tests 10 passed (10)
```

The new tests reserve distinct seats inside the visible lead's Area, leave a nearer neighboring Area's seat untouched, tick the real character engine until characters are seated in TYPE state, release/reuse a completed sub-agent's seat, release all remaining sub-agent seats, and confirm these transient reservations are omitted from `getPersistableSeats()`.

### RED — ambiguous ownership and metadata-only fork expiry

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts` at 13:46:58, exit 1, before adding the ambiguity gate and metadata-only fork pruning:

```text
FAIL does not guess ownership when live sibling spawns reuse an id without parent metadata
AssertionError: expected true to be false
FAIL retires a watched metadata-only fork after its activity grace expires
AssertionError: expected true to be false
__tests__/nestedSubagents.test.ts:195:52
Test Files 1 failed (1)
Tests 2 failed | 8 passed (10)
```

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts __tests__/backgroundAgents.test.ts __tests__/claudeTeamProvider.test.ts __tests__/agentRuntime.test.ts` at 13:47:17, exit 0: **4 files, 82 passed**.

### Mutants — all removed before final GREEN

No prior commit contains this implementation, so before each mutation the production file was copied to a temporary backup: `/tmp/pixel-task2-watcher.before-mutant.ts`, `/tmp/pixel-task2-subagent.before-mutant.ts`, and `/tmp/pixel-task2-office.before-mutant.ts`. Each backup was restored immediately after the failing run. The mutants never reached a commit.

1. Remove shadow-source lookup (two added lines):

```diff
-  const source = agents.get(leadId) ?? subagentWatch?.store.get(leadId);
+  // MUTANT: lose the shadow transcript that owns the nested spawn.
+  const source = agents.get(leadId);
```

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts -t 'discovers a spawn from a shadow'` at 13:48:25, exit 1:

```text
AssertionError: expected false to be true
__tests__/nestedSubagents.test.ts:113:53
Test Files 1 failed (1)
Tests 1 failed | 9 skipped (10)
```

2. Collapse projected descendant keys to raw tool ids:

```diff
-    const spawnToolUseId =
-      originAgentId === leadId && !entry.isFork ? entry.toolUseId : `subagent:${id}`;
+    // MUTANT: collapse nested siblings onto their reused raw tool id.
+    const spawnToolUseId = entry.toolUseId;
```

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts -t 'keeps siblings with reused'` at 13:48:26, exit 1:

```text
AssertionError: expected 'toolu-inner' not to be 'toolu-inner'
__tests__/nestedSubagents.test.ts:216:34
Test Files 1 failed (1)
Tests 1 failed | 9 skipped (10)
```

3. Disable free-seat selection (two added lines):

```diff
-    const seatId = anchor ? closestFreeSeat(areaSeats, anchor.col, anchor.row) : null;
+    // MUTANT: ignore the available in-area seats.
+    const seatId = null;
```

`npm exec -w webview-ui -- vitest run test/subagentAreaSeating.test.ts -t 'flattened descendants reserve'` at 13:48:27, exit 1:

```text
AssertionError: first descendant must own a seat
 test/subagentAreaSeating.test.ts:140:10
Test Files 1 failed (1)
Tests 1 failed | 5 skipped (6)
```

### Caller wiring proof — hooks on and off

The final integration suite adds two cases using the actual `runtime.startProjectScan` timer. Each advances `PROJECT_SCAN_INTERVAL_MS`, observes fork adoption, ages the transcript beyond ten minutes, advances the same timer again and observes removal. `ensureProjectScan` calls `scanAllTeammateFiles` before its hooks-mode gate. The stale comment above `scanAllTeammateFiles` was updated to describe main/shadow sources.

Because these caller cases started green, a fourth two-line mutant inserted an early hooks return immediately before `scanAllTeammateFiles`:

```diff
+    // MUTANT: suppress fallback discovery when hooks are enabled.
+    if (hooksEnabledRef?.current) return;
     scanAllTeammateFiles(
```

Backup: `/tmp/pixel-task2-caller.before-mutant.ts`. `npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts -t 'periodic runtime caller'` at 13:51:04, exit 1:

```text
AssertionError: expected false to be true
__tests__/nestedSubagents.test.ts:330:52
Test Files 1 failed (1)
Tests 1 failed | 1 passed | 10 skipped (12)
```

The hooks-off caller case still passed. The mutant was restored immediately; final backend GREEN including both caller cases:

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts __tests__/backgroundAgents.test.ts __tests__/claudeTeamProvider.test.ts __tests__/agentRuntime.test.ts` at 13:51:05, exit 0:

```text
Test Files 4 passed (4)
Tests 84 passed (84)
```

### Earlier focused GREEN and final checks

`npm exec -w server -- vitest run __tests__/nestedSubagents.test.ts __tests__/backgroundAgents.test.ts __tests__/claudeTeamProvider.test.ts __tests__/agentRuntime.test.ts` at 13:48:54, exit 0:

```text
Test Files 4 passed (4)
Tests 82 passed (82)
```

`npm exec -w webview-ui -- vitest run test/subagentAreaSeating.test.ts test/teammateSeating.test.ts` at 13:48:55, exit 0:

```text
Test Files 2 passed (2)
Tests 10 passed (10)
```

`npm run check-types` at 13:48:57, exit 0:

```text
tsc --noEmit && tsc --noEmit -p server/tsconfig.test.json
(no diagnostics)
```

The first final format check at 13:48:57 flagged a newly edited provider comment; `npx prettier --write server/src/providers/hook/claude/claudeTeamProvider.ts` corrected it. Focused formatting/lint at 13:49:05 and repeated with typecheck after the timer-caller cases at 13:51:24; all exit 0:

```text
npx prettier --check core/src/teamProvider.ts server/src/agentRuntime.ts server/src/fileWatcher.ts server/src/subagentWatch.ts server/src/providers/hook/claude/claudeTeamProvider.ts server/__tests__/nestedSubagents.test.ts server/__tests__/claudeTeamProvider.test.ts webview-ui/src/office/engine/officeState.ts webview-ui/test/subagentAreaSeating.test.ts
All matched files use Prettier code style!
npx eslint core/src/teamProvider.ts server/src/agentRuntime.ts server/src/fileWatcher.ts server/src/subagentWatch.ts server/src/providers/hook/claude/claudeTeamProvider.ts server/__tests__/nestedSubagents.test.ts server/__tests__/claudeTeamProvider.test.ts
(no diagnostics)
npm exec -w webview-ui -- eslint src/office/engine/officeState.ts test/subagentAreaSeating.test.ts
(no diagnostics)
```

Full suites/build and closing checks on the delivered commit remain assigned to the parent orchestrator. This constructor has not claimed those passed.

## JUDGMENT — constructor, compared against requested issue #418 behavior

Confidence: high for the fixture-covered runtime and engine behavior.

- The scanner resolves the actual source transcript in the appropriate store and its visible main-store lead separately. Spawn liveness stays on the origin shadow; changing only the id to the visible lead would lose this evidence. No shadow is inserted into the main store, registered with the session router or persisted.
- Sidecar `parentAgentId` is now an optional provider contract field. Metadata-only forks are discoverable when their parent resolves to an already visible/watched ancestor; missing parents and isolated cycles do not create characters. Stale metadata-only forks expire after ten minutes because no spawn-completion tool exists for them.
- The periodic fallback includes shadow sources and visible teammates, so a sidecar that appears after the immediate callback can still be discovered. Nested watches keep their own origin for completion and use distinct projected keys under the visible lead. Reused raw tool ids do not merge siblings; ambiguous entries without parent provenance are not guessed.
- Completion removes the appropriate origin's descendant and recursively cleans its children. Every runtime `removeAgent` path now stops watches belonging to that visible agent, including activity-expiry removal. Top-level named-spawn classification is preserved; nested shadow spawns/forks remain sub-agents rather than being promoted by a sidecar label.
- The webview already creates lazy sub-agent characters from `subagentToolStart`. Nested/fork presence uses that existing message path with a unique projected parent-tool key. Its background-parent key is retained across `agentToolsClear`; `subagentClear` removes the projected key. No protocol message type was added. Free in-area seats are now reserved before the previous free-tile fallback. Persisted seat payloads continue excluding sub-agents.

The deliberate addition relative to the old code is actual chair-seat assignment: commit `750cafe` only spread characters across free floor tiles. The explicit current request requires a free seat, so the glossary's old “not in a seat” phrase was updated to describe seated descendants and overflow. Overflow with no free in-area seat retains a free-tile fallback instead of taking a seat from a neighboring Area.

### Dispatch record — orchestrator handoff reproduced by constructor

- `/root/constructor`, task 1: `fileWatcher.ts`, `constants.ts`, restore in `agentRuntime.ts`, process helper and related tests; completed in commit `5023fb1`.
- The same `/root/constructor`, task 2: runtime discovery callback/scanner, shadow-store origin and cleanup, provider parent metadata, and the existing webview consumer/area seating. Work ran sequentially because the user specified task order and both tasks modify `agentRuntime.ts` and `fileWatcher.ts`.
- Same inherited Codex session/model family. No alternative provider/model was used; requested opus/sonnet assignments are unavailable here. No independent specialist review or auditor APROBADO is implied: this request is constructor work plus checks, and this repository has no OPSX root.
- Parent orchestration supplied the user's diagnosis, ownership-collision and lifecycle cases, and pointed out the actual-seat gap. Those are declared inputs, not independent convergence. No auditor dictated cases, no sibling reviewer conclusions were read, and no reviewer tool restrictions were enforced. The implementation report was written by the constructor in full; the parent may reference it but it does not replace a reviewer report.

## ASSUMPTION — explicit limits

The supported fork fixture is the requested `<project>/<session>/subagents/agent-<id>.jsonl` plus `.meta.json` with a string `parentAgentId`, matching either `agent-<id>` or `<id>`. No running Claude walkthrough was performed, no upstream issue claim beyond the supplied diagnosis was independently verified, and no React/transport browser walkthrough was performed. Runtime callbacks and the office engine were exercised separately through their existing message contract. Without a free seat in the lead's Area, seating is impossible and the existing in-area floor-tile fallback is retained. The running server on 4310 remains untouched and will continue its previous loaded behavior until the user chooses to restart it.
