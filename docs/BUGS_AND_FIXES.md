# Bugs Investigated & Root-Cause Fixes (`BUGS_AND_FIXES.md`)

## Defect 1: `run_command` Failing Repeatedly in Agent Loop

### Symptoms Observed
In session `conv-1776442006905`, the assistant created `calculator.py` and `test_calculator.py`, then attempted to run `run_command` 5 times in a row. Every invocation failed (`status: "error"`), and the agent stopped at step 6 without ever running the Python program.

### Root Causes Identified
1. **Unnormalized Tool Parameter Names**: Models frequently emit `{"cmd": "python3 test_calculator.py"}` or `{}` when invoking `run_command`. `executeToolCall` previously read `String(args.command || '')` directly, treating `cmd` as an empty command.
2. **Hidden Permission Approval Prompt & Generic Denial Message**: `EXECUTE_COMMANDS` defaults to `ASK`. When the user did not notice the approval badge in the right inspector within 45 seconds, `checkPermissionAndMaybeWait` timed out and returned `"Tool run_command was denied by permission policy or user"`. Because the error message did not explain *why* it failed or how to approve it, the model blindly retried the identical tool call until its iteration budget ran out.
3. **Duplicate Tool Call Loop**: No loop-breaker existed to stop the model from calling the exact same failing tool with identical arguments on consecutive turns.
4. **Missing Host Toolchain Guidance**: The model attempted to run `pytest` (not installed in the container) instead of `python3 -m unittest` (installed).

### Engineering Fixes Applied
- Integrated `normalizeAndValidateToolArgs` (`src/server/sourceIntegrations.ts`), mapping `cmd` / `script` / `commandLine` -> `command`, `file` / `filepath` -> `path`, and returning clear schema hints if required fields are missing.
- Upgraded `checkPermissionAndMaybeWait` in `server.ts` to distinguish between explicit `DENY` policy, user rejection, and approval timeout, and added a prominent **Inline Permission Approval Required** banner directly inside `ChatTab.tsx` above the composer.
- Added duplicate tool-call detection in `BoundedAgentLoopRunner` so identical failed calls cannot loop infinitely.
- Injected verified host toolchain availability (`python3`, `unittest`, `node`, `npm`, `git`) into the agent system prompt.

---

## Defect 2: Agent Stopping Arbitrarily at 6 Steps (`MAX_ITERATIONS = 6`)

### Symptoms Observed
Multi-step coding tasks that required reading files, writing implementation, writing tests, running tests, fixing a bug, and re-running tests hit the hardcoded `const MAX_ITERATIONS = 6` ceiling in `server.ts` and returned `"Agent reached maximum tool iteration limit (6)."` with no way to continue.

### Engineering Fixes Applied
- Replaced the hardcoded loop with `BoundedAgentLoopRunner` (`src/server/workstationEngine.ts`).
- Increased default `maxAgentIterations` to `10` (configurable from `4` to `20` directly in the Chat header and Settings).
- Added explicit `paused_iteration_limit` state on the assistant message and implemented `POST /api/chat/continue` + a **Continue Task** button in `ChatTab.tsx` and `POST /api/chat/retry-tool` for single-step retries.

---

## Defect 3: `WorkspaceFile(20)` Stale File Count & Explorer Desync

### Symptoms Observed
After the agent created `calculator.py` and `test_calculator.py` in `android-workstation`, the UI header and workspace switcher continued to display `20 files` instead of `22 files`.

### Root Cause Identified
`App.tsx` only fetched `/api/workspaces` once on initial mount and never refreshed workspace metadata after `/api/chat/send` completed. Furthermore, `ProjectsTab.tsx` only reloaded its file list when `activeWorkspaceId` changed, not when `fileCount` changed.

### Engineering Fixes Applied
- Added `refreshWorkspacesAndCheckpoints` in `App.tsx` and invoked it automatically after every `handleSendMessage`, `handleContinueTask`, `handleRetryToolCall`, and `handleStopGeneration`.
- Updated `ProjectsTab.tsx` `useEffect` dependency array to `[activeWorkspaceId, activeWsSummary?.fileCount]` and added real folder creation (`POST /api/workspaces/:id/mkdir`) and file renaming (`POST /api/workspaces/:id/rename`).
