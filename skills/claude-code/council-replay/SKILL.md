---
name: council-replay
description: |
  Replay a past Agent Council session in the terminal. Shows the full
  deliberation: question, each agent's opinion, and the chairman's synthesis.
allowed-tools:
  - Bash
---

# Council Replay

Replay a past council deliberation session in the terminal.

## Usage

The user invokes `/council-replay <session-id>`.

## Run

Replace `{SESSION_ID}` with the session ID the user provided.

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN replay {SESSION_ID} --project "$SLUG"
```

After the replay, tell the user:

> **Next steps:**
> - Re-run with current context: `/council-revisit <session-id>`
> - Record outcome: `/council-outcome <session-id> "what happened"`
> - Open viewer: `open ~/.council/{project}/{session-id}/viewer.html`
