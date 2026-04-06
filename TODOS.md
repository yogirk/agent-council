# TODOS

## Tech Debt

### Refactor detectChairman() to use Bun.spawnSync
**What:** Replace `execSync` + `require('child_process')` with `Bun.spawnSync` in `council.ts:664-683`.
**Why:** Every other subprocess call in the codebase uses Bun.spawn/spawnSync. This is the only CommonJS require. Inconsistent subprocess pattern.
**Effort:** ~15 min
**Depends on:** Nothing

## Future Features

### Full input snapshotting for sessions
**What:** Store the actual resolved file contents (not just file paths) in the session directory when running a council. Save the bundled context output alongside opinions.
**Why:** Revisit and nudge comparisons are only meaningful if you know what the agents saw originally. Currently `context_files` stores paths, but file contents may change between sessions. Codex flagged this as a reproducibility prerequisite.
**Effort:** ~30 min
**Context:** `meta.json` stores `context_files` as `string[]`. `buildContextBundle()` reads files at dispatch time. Snapshot would save bundled output to `session/context_snapshot.txt`.
**Depends on:** Nothing. Can be added independently.
