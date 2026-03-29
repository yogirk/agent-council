---
name: council-list
description: |
  List all past Agent Council sessions for the current project.
  Shows session ID, mode, agent count, and question for each.
allowed-tools:
  - Bash
---

# Council List

Show all past council deliberation sessions for this project.

## Run

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN list --project "$SLUG"
```

After showing the list, tell the user:
- To replay a session: `/council-replay <session-id>`
- To open the viewer: `open ~/.council/{project}/{session-id}/viewer.html`
