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
COUNCIL_BIN=$([ -x "$HOME/.claude/skills/agent-council/bin/council" ] && echo "$HOME/.claude/skills/agent-council/bin/council" || echo "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/bin/council")
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN replay {SESSION_ID} --project "$SLUG"
```

After the replay, tell the user:
- To open the interactive viewer: `open ~/.council/{project}/{session-id}/viewer.html`
- To list all sessions: `/council-list`
