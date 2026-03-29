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
COUNCIL_BIN=$([ -x "$HOME/.claude/skills/agent-council/bin/council" ] && echo "$HOME/.claude/skills/agent-council/bin/council" || echo "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/bin/council")
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
$COUNCIL_BIN outcome {SESSION_ID} --result "{RESULT}" --project "$SLUG"
```

After recording, tell the user:
- The outcome has been saved to the session's meta.json
- The viewer has been updated with an outcome banner
- They can open the viewer to see the annotation
