# Changelog

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
