---
name: council-revisit
description: |
  Revisit a past Agent Council decision with current codebase context.
  Re-runs the same question through the council and shows a side-by-side
  comparison of what changed. Use for living decisions.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Council Revisit (Living Decisions)

Re-run a past council deliberation with the current state of the codebase. Produces a
side-by-side comparison showing how the council's opinions have evolved.

## Usage

The user invokes `/council-revisit <session-id>`.

If the user doesn't provide a session ID, run `/council-list` first to show available sessions.

## Run

Replace `{SESSION_ID}` with the session ID the user provided.

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
# Detect which CLI is invoking (whoever runs this is the chairman)
_CHAIRMAN="claude"
[ -n "$CODEX_SESSION_ID" ] || [ -n "$OPENAI_API_KEY" ] && command -v codex &>/dev/null && _CHAIRMAN="codex"
[ -n "$GEMINI_API_KEY" ] && command -v gemini &>/dev/null && _CHAIRMAN="gemini"
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
SESSION_DIR=$($COUNCIL_BIN revisit {SESSION_ID} --chairman "$_CHAIRMAN" --project "$SLUG")
echo "SESSION_DIR=$SESSION_DIR"
```

## After dispatch

Follow the same Steps 2-5 from the `/council` skill:
1. Read the opinion files from $SESSION_DIR/stage1/
2. Synthesize as chairman (you have the original question + new opinions)
3. Save synthesis.json to $SESSION_DIR/
4. Tell the user about the viewer: "Open the viewer to compare original vs revisit side-by-side."
