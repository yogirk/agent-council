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
COUNCIL_BIN=$([ -x "$HOME/.claude/skills/agent-council/bin/council" ] && echo "$HOME/.claude/skills/agent-council/bin/council" || echo "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/bin/council")
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN list --project "$SLUG"
```

After showing the list, tell the user:
- To replay a session: `/council-replay <session-id>`
- To open the viewer: `open ~/.council/{project}/{session-id}/viewer.html`
