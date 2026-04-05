---
name: council-nudge
description: |
  Nudge a specific agent to reconsider its opinion based on a corrected assumption.
  Sends the original question + response + correction to one agent and saves the
  updated opinion alongside the original for comparison.
allowed-tools:
  - Bash
---

# Council Nudge

Correct an assumption and re-run a single agent to see how their opinion changes.

## Usage

The user invokes `/council-nudge <session-id> --agent <agent> --correction "text"`.

If the user doesn't provide a session ID, run `/council-list` first to show available sessions.

## Run

Replace `{SESSION_ID}`, `{AGENT}`, and `{CORRECTION}` with the user's values.

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
SESSION_DIR=$($COUNCIL_BIN nudge {SESSION_ID} --agent {AGENT} --correction "{CORRECTION}" --project "$SLUG")
echo "SESSION_DIR=$SESSION_DIR"
```

## After nudge

Tell the user:
- The nudged opinion has been saved alongside the original
- Open the viewer to see the before/after comparison in the "Nudge History" tab
- They can nudge the same or different agents with additional corrections

> **Next steps:**
> - Nudge another agent: `/council-nudge {SESSION_ID} --agent <other-agent> --correction "..."`
> - Browse sessions: `/council-list`
> - Open viewer: `open ~/.council/{project}/{session-id}/viewer.html`
