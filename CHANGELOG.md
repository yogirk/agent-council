# Changelog

## [0.4.0] - 2026-04-07

### Changed

- **Bun-native subprocess calls.** Replaced `require("child_process").execSync` in `detectChairman()` with `Bun.spawnSync`. Replaced inline `require("fs")` in `isPathSafe()` with the existing top-level import. Zero CommonJS requires remain.
- **Context snapshotting.** Sessions now save a `context_snapshot.txt` with the resolved file contents agents saw at dispatch time. Enables accurate revisit and nudge comparisons even when source files change between sessions. Applies to both `run` and `revisit` flows.

## [0.3.0] - 2026-04-06 — Epistemic Debugger

Reliability, error intelligence, and the ability to challenge agent assumptions mid-session.

### Added

- **Preflight health checks.** Before a session starts, each agent gets a version check and no-op prompt to verify auth and connectivity. Reports ready/degraded/down with actionable messages ("codex authentication expired. Run `codex login` to fix."). Bypass with `--skip-preflight`.
- **Error classification.** Failed agents now get a typed `error_class` (auth, rate_limit, timeout, parse, startup, unknown) with human-readable messages explaining what went wrong and how to fix it.
- **Retry wrapper.** Transient failures (timeout, rate_limit, unknown) get one automatic retry with a 3s backoff. Non-transient failures (auth, parse, startup) fail immediately.
- **Nudge subcommand** (`council nudge <session> --agent <agent> --correction "text"`). Challenge a specific agent's assumptions after a session. The agent reconsiders with your correction and produces an updated recommendation. Saves to `stage4/` and regenerates the viewer.
- **Assumptions and belief triggers.** Agents now output `### Assumptions` and `### What Would Change My Mind` sections. Parsed with fuzzy heading matching ("Key Assumptions", "My Assumptions" all work). Prose fallback for non-bullet formats.
- **SIGKILL timer fix.** Force-kill timer is now properly cleared on normal process exit, preventing leaked timers.
- **Nudge skill** (`/council-nudge`). SKILL.md for the nudge workflow with usage examples.
- **Schema version 2.** Sessions now include `schema_version: 2` for forward compatibility.

### Changed

- `dispatchWithQuorum()` uses retry wrapper for Stage 1, no retries for Stage 2.
- Stage 1 prompt updated to request assumptions and belief update triggers.
- 59 tests (up from 39), including preflight classification, nudge prompt, assumptions parsing, fuzzy headings.

## [0.2.0] - 2026-04-05

Viewer redesign, consensus fix, contextual nudges moved to skill flow.

### Added

- Contextual nudges in skill flow (removed global instruction nudges).
- Cross-platform documentation (macOS/Linux, WSL for Windows).

### Fixed

- Consensus KPI now shows actual agreement percentage, not response rate.
- Viewer includes chairman synthesis via regenerate-viewer command.
- macOS compatibility for nudge install (awk instead of sed).

### Changed

- Redesigned HTML viewer: editorial monograph layout with tonal surfaces, tabbed agent opinions, peer review matrix, nudge timeline.

## [0.1.0] - 2026-03-29 — First Release

Agent Council: convene a panel of CLI-based AI agents (Claude Code, Codex, Gemini CLI) to deliberate on engineering questions through structured multi-stage discussion, peer review, and synthesis.

### Added

- **Three-stage deliberation protocol.** Stage 1: all agents answer independently in parallel. Stage 2 (optional): anonymized peer review with Borda count ranking. Stage 3: chairman synthesizes consensus, divergence, and recommendation.
- **Three CLI adapters.** Claude Code, OpenAI Codex, and Gemini CLI with per-agent timeout configuration. Gemini defaults to 180s (it's slower). All output parsed from native JSON formats.
- **Quorum-based dispatch.** Once enough agents respond, a 30s grace window starts for stragglers. No more waiting for the slowest agent when you already have enough opinions.
- **Progressive terminal output.** Recommendation snippets shown as each agent responds in real-time.
- **Living decisions** (`/council-revisit`). Re-run a past council with current codebase context. Parent/child session linkage. Viewer shows side-by-side "Revisit Diff" tab.
- **Outcome tracking** (`/council-outcome`). Record whether a council decision was correct. Builds calibration data over time.
- **Redesigned HTML viewer.** Side-by-side agent cards with color-coded borders (purple/green/blue), stage tabs, summary bar, collapsible sections, outcome banners, revisit diffs. Self-contained, XSS-safe.
- **Proactive nudge system.** Ambient skill detects decision moments and suggests the right council command. Pattern-based, max 2 per session, configurable.
- **Security hardening.** Path traversal protection, input validation, XSS escaping in viewer, shell injection defense via temp files.
- **Cross-platform skill support.** SKILL.md files work with Claude Code, Codex CLI, and Gemini CLI. Setup installs to all detected platforms.
- **Evaluation framework.** 10 benchmark questions comparing council vs single agent. Council found ~2x more considerations in testing.
- **6 slash commands.** `/council`, `/council-list`, `/council-replay`, `/council-revisit`, `/council-outcome`, plus ambient `agent-council-nudge`.
- **npx installer.** `npx agent-council` for one-command setup.
- **39 tests, zero dependencies.** Bun runtime, built-in test runner, real CLI output fixtures.
