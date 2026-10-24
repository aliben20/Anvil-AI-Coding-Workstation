# Test & Verification Report (`TEST_REPORT.md`)

## 1. Real-Terminal Acceptance Tests (Tests A – J against Real `/bin/bash` OS PTY)

All 10 acceptance tests in `tests/workstation.test.ts` (Tests 16–18) run directly against the real Linux kernel PTY (`pty.openpty()` $\rightarrow$ `/dev/pts/N`) and `/bin/bash --norc -i`:

| Acceptance Test | Command(s) Executed in Real PTY Session | Actual Recorded Result | Status |
| :--- | :--- | :--- | :--- |
| **Test A — Identify Shell & PTY** | `echo "SHELL=$0" && uname -s -m && tty` | `SHELL=/bin/bash`, `Linux x86_64`, `/dev/pts/0` (`transportMode: 'pty'`, live `shellPid`) | **PASS** |
| **Test B — Persistent Directory (`cd`)** | `pwd` $\rightarrow$ `mkdir -p obsidian-terminal-test` $\rightarrow$ `cd obsidian-terminal-test` $\rightarrow$ `pwd` | Initial `cwd` (`.../python-cli-toolkit`) changed to `.../python-cli-toolkit/obsidian-terminal-test` across separate commands while `shellPid` remained identical. | **PASS** |
| **Test C — Persistent Variable (`export`)** | `export OBSIDIAN_TEST=working` $\rightarrow$ `echo "$OBSIDIAN_TEST"` | Second command printed `working` from the persistent shell environment. | **PASS** |
| **Test D — Real File Creation** | `printf 'real terminal test\n' > terminal-proof.txt` $\rightarrow$ `cat terminal-proof.txt` | Verified `terminal-proof.txt` exists on host filesystem (`fs.existsSync === true`) with exact content `'real terminal test\n'`. | **PASS** |
| **Test E — Error Reporting** | `nonexistent_command_xyz_999` | Returned `bash: nonexistent_command_xyz_999: command not found` with nonzero exit status `127`. | **PASS** |
| **Test F — Interactive Behavior (`stdin`)** | `python3 -u -c "v = input('INTERACTIVE_PROMPT>'); print('INTERACTIVE_GOT:' + v)"` + live `writeInput('hello_from_stdin\r')` | Prompt streamed live prior to newline; sending `hello_from_stdin\r` produced `INTERACTIVE_GOT:hello_from_stdin`. | **PASS** |
| **Test G — Foreground Cancellation (`SIGINT`)** | `sleep 25` $\rightarrow$ `interruptSession` (`SIGINT` / `Ctrl+C`) $\rightarrow$ `echo "SHELL_STILL_ALIVE_AFTER_SIGINT"` | Foreground `sleep 25` terminated via process-group `SIGINT` while the interactive `/bin/bash` session (`shellPid`) stayed alive and printed `SHELL_STILL_ALIVE_AFTER_SIGINT`. | **PASS** |
| **Test H — Session Isolation** | Created `session1` and `session2`; ran `cd isolated-sub && export ISOLATED_KEY=secret_s1` in `session1`; checked `pwd` and `$ISOLATED_KEY` in `session2` | `session1` had `VAL=secret_s1` inside `isolated-sub`; `session2` remained in root workspace directory with `VAL=UNSET`. | **PASS** |
| **Test I — Output, UTF-8 & Resize (`TIOCSWINSZ`)** | `resizeSession(id, 132, 42)` $\rightarrow$ `stty size && printf "UTF8_OK: Ω ≈ √ 🚀\n" && seq 1 120 \| tail -n 3` | `stty size` reported `42 132` (`rows cols`), multi-byte UTF-8 rendered cleanly (`UTF8_OK: Ω ≈ √ 🚀`), and 120-line output streamed through `120`. | **PASS** |
| **Test J — Session Cleanup** | `closeSession(session1)` & `closeSession(session2)` + `/proc/<pid>` verification | Both sessions transitioned to `exited` and `/proc/<shellPid>` was confirmed absent (`false`). | **PASS** |

---

## 2. Full Workstation Unit & Integration Suite (`18/18 Passing`)

- **Tests 1–15**: SecretRedactor, AES-256-GCM Vault, Path Traversal Sandbox, Workspace Diffs & Checkpoints, Binary File Guard, Stateful One-Shot Executor, GGUF Binary Header Parser, Python & Android Build Verifier, Scoped Memory Store, PocketStrike-AI Argument Normalizer, Timeout/AbortSignal/Safety Guards, Mkdir/Rename/FileCount Sync, End-to-End Bounded ReAct Agent Python Fix Loop, Iteration Limit Pause/Resume, and Mobile-Harness/PocketStrike-AI Provenance & Manifest Security Audit.
- **Tests 16–18**: Real-Terminal Acceptance Tests A through J on actual Linux PTY (`/dev/pts/N`).
