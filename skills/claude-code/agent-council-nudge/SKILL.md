---
name: agent-council-nudge
preamble-tier: 3
description: |
  Ambient awareness for Agent Council. Detects moments where convening a
  multi-model council would genuinely help and suggests the right command.
  Never interrupts. Never nags. Just a quiet tip at the right moment.
allowed-tools:
  - Bash
---

## Preamble

```bash
# Read proactive config from ~/.council/config.json
_COUNCIL_PROACTIVE="true"
if [ -f "$HOME/.council/config.json" ]; then
  _CP=$(cat "$HOME/.council/config.json" 2>/dev/null | grep -o '"proactive"[[:space:]]*:[[:space:]]*[a-z]*' | grep -o 'true\|false')
  [ -n "$_CP" ] && _COUNCIL_PROACTIVE="$_CP"
fi
echo "COUNCIL_PROACTIVE: $_COUNCIL_PROACTIVE"

# Check for stale sessions (>7 days, no outcome recorded)
_STALE_SESSION="none"
_STALE_DAYS=""
if [ -d "$HOME/.council" ]; then
  for _meta in $(find "$HOME/.council" -name "meta.json" -mtime +7 2>/dev/null | head -5); do
    if ! grep -q '"outcome"' "$_meta" 2>/dev/null; then
      _STALE_SESSION=$(basename "$(dirname "$_meta")")
      _STALE_DAYS=$(( ( $(date +%s) - $(date -r "$_meta" +%s) ) / 86400 ))
      break
    fi
  done
fi
echo "STALE_SESSION: $_STALE_SESSION"
[ "$_STALE_SESSION" != "none" ] && echo "STALE_DAYS: $_STALE_DAYS"

# Session nudge counter (max 2 per session)
_NUDGE_FILE="/tmp/council-nudges-$$"
_NUDGE_COUNT=$(cat "$_NUDGE_FILE" 2>/dev/null || echo "0")
echo "NUDGE_COUNT: $_NUDGE_COUNT"
```

## Nudge Behavior

If `COUNCIL_PROACTIVE` is `"false"`: do nothing. Do not suggest any council commands.
The user opted out.

If `COUNCIL_PROACTIVE` is `"true"` AND `NUDGE_COUNT` is less than 2:

You may suggest council commands at **natural pause points** in the conversation.
The suggestion goes AFTER your full response, as a single quiet line. Never as a
question. Never as the main content. Never mid-thought.

### When to suggest `/council`

If the user's message matches ANY of these patterns:
- Explicit comparison: "should we use X or Y", "X vs Y", "which approach"
- Trade-off language: "trade-off", "pros and cons", "compare options"
- Architecture decisions: "how should we structure", "what pattern", "which database"
- Decision paralysis: "I'm not sure", "I'm torn", "what do you think about" + technical topic
- Multiple competing options being weighed

**Suggest:** `Tip: Looks like a decision with trade-offs. /council gets 3 independent AI perspectives on this.`

Do NOT suggest /council for:
- Simple factual questions ("what does this function do?")
- Bug fixes with a clear solution
- Code generation requests ("write a function that...")
- Questions you can answer confidently without diverse perspectives

### When to suggest `/council-revisit`

If the user's message matches ANY of these:
- References a past decision: "remember when we chose", "we decided to use X"
- Reconsideration language: "should we reconsider", "rethink", "revisit", "was that the right call"
- Discussing code that was the subject of a past council (if you happen to know)

**Suggest:** `Tip: You may have a past council session on this topic. /council-list to check, then /council-revisit to compare with fresh eyes.`

### When to suggest `/council-outcome`

If `STALE_SESSION` is not "none":
- After the user mentions shipping, deploying, merging, or completing work
- At natural retrospective moments ("that went well", "we should have done X")
- When discussing results of a past decision

**Suggest:** `Tip: Council session {STALE_SESSION} is {STALE_DAYS} days old with no outcome recorded. /council-outcome {STALE_SESSION} "what happened" to track how the decision played out.`

### After nudging

Increment the counter so you don't exceed 2 per session:
```bash
echo "$(( _NUDGE_COUNT + 1 ))" > /tmp/council-nudges-$$
```

### Hard rules

- **Max 2 nudges per session.** After 2, stop entirely. No exceptions.
- **Never nudge for /council-list or /council-replay.** Users discover these naturally.
- **Never nudge twice for the same command type** in one session.
- **If the user says "stop suggesting"**, "don't nudge me", or shows any irritation: stop for the rest of the session. Do not apologize profusely, just stop.
- **Never make the nudge a question.** It's a statement. "Tip: ..." not "Would you like to...?"
- **Never nudge when the user is in the middle of a task.** Wait for a natural completion point.
