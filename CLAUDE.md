# Agent Council

Multi-agent deliberation tool. Convenes Claude Code, Codex CLI, and Gemini CLI to deliberate on questions.

## Architecture

- `src/council.ts` — CLI entry point, orchestration, subprocess dispatch, quorum logic, all subcommands
- `src/adapters.ts` — Agent adapters (Claude, Codex, Gemini) + shared types (SessionMeta, AgentResult)
- `src/prompts.ts` — Stage 1, 2, 3 prompt templates
- `src/viewer.ts` — Self-contained HTML viewer generation (verdict-first, progressive depth, light/dark mode)
- `bin/council` — Bun entry script
- `skills/claude-code/` — SKILL.md files for all slash commands (cross-platform compatible)
- `eval/` — Benchmark framework (10 questions, run-eval.ts)

## Testing

Run: `bun test`
Framework: Bun built-in test runner
Fixtures: `tests/fixtures/` — real CLI output from Claude, Codex, Gemini

## Key patterns

- `buildContextBundle()` has path traversal protection — validates all file paths
- `dispatchWithQuorum()` handles parallel agent dispatch with per-agent timeouts and grace windows
- `writeJson()` is async with atomic rename (write to .tmp, then rename)
- `detectChairman()` auto-detects invoking CLI from environment signals
- SKILL.md files use universal binary discovery (checks all CLI skill directories)
- Viewer uses `escapeJsonForScript()` for XSS protection + `textContent` everywhere (no innerHTML)
- `main()` is guarded from running during test imports

## Storage

Sessions: `~/.council/{project}/{session-id}/`
Config: `~/.council/config.json`

## Config defaults

- Claude: 120s timeout, Codex: 120s, Gemini: 180s
- Quorum grace: 30s
- Models: claude-opus-4-6, gpt-5.4, gemini-3.1-pro
- Proactive nudges: true
