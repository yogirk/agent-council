---
name: council-outcome
description: |
  Record the outcome of a past Agent Council decision. Was the council right?
  Builds calibration data over time to learn which models are best at what.
allowed-tools:
  - Bash
---

# Council Outcome

Record whether a past council decision turned out to be correct.

## Usage

The user invokes `/council-outcome <session-id> "description of what happened"`.

If the user doesn't provide a session ID, run `/council-list` first to show available sessions.

## Run

Replace `{SESSION_ID}` and `{RESULT}` with the user's values.

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$HOME/.copilot/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN outcome {SESSION_ID} --result "{RESULT}" --project "$SLUG"
```

After recording, tell the user:
- The outcome has been saved to the session's meta.json
- The viewer has been updated with an outcome banner
- They can open the viewer to see the annotation
