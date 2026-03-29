---
name: council
description: |
  Convene a panel of CLI-based AI agents (Codex, Gemini) to deliberate on a
  question. Each agent answers independently, then you synthesize the council's
  verdict as chairman. Use for architecture decisions, code review, debugging
  hypotheses, or any question where diverse perspectives add value.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Agent Council

Convene a multi-agent council to deliberate on a question. You (Claude) are the
chairman. Other CLI agents (Codex, Gemini) provide independent opinions. You
synthesize the final verdict.

## Usage

The user invokes `/council "their question"` or `/council --with-review "their question"`.

## Step 1: Dispatch the council

Run this bash block. Replace `{QUESTION}` with the user's actual question text.

```bash
COUNCIL_BIN=""; for _d in "$HOME/.claude/skills/agent-council" "$HOME/.agents/skills/agent-council" "$HOME/.gemini/skills/agent-council" "$(git rev-parse --show-toplevel 2>/dev/null)"; do [ -x "$_d/bin/council" ] && COUNCIL_BIN="$_d/bin/council" && break; [ -x "$_d/council" ] && COUNCIL_BIN="$_d/council" && break; done; [ -z "$COUNCIL_BIN" ] && COUNCIL_BIN="$(which council 2>/dev/null || echo "bin/council")"
QUESTION_FILE=$(mktemp /tmp/council-q-XXXXXX)
cat <<'COUNCIL_EOF' > "$QUESTION_FILE"
{QUESTION}
COUNCIL_EOF
SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
SESSION_DIR=$($COUNCIL_BIN --question-file "$QUESTION_FILE" --project "$SLUG")
rm -f "$QUESTION_FILE"
echo "SESSION_DIR=$SESSION_DIR"
```

If the user passed `--with-review`, add that flag to the council command.
If the user passed `--quick`, add that flag instead.

## Step 2: Read the council opinions

After the bash block completes, read the opinion files from the session directory:

1. Read `$SESSION_DIR/meta.json` to understand the session structure
2. Read each file in `$SESSION_DIR/stage1/` (opinion_codex.json, opinion_gemini.json, etc.)
3. If `--with-review` was used, also read files in `$SESSION_DIR/stage2/`

## Step 3: Synthesize as chairman

You are the chairman. You have the full conversation context with the user PLUS the
council opinions. Produce the synthesis:

- **Consensus:** Where all agents agree
- **Divergence:** Where agents disagree. State each position fairly with agent name.
- **Recommendation:** Your synthesized answer drawing from the strongest elements.
- **Confidence:**
  - If all agree: **HIGH** — Strong consensus across models.
  - If majority agrees: **MEDIUM** — Majority view with notable dissent.
  - If fundamental disagreement: **LOW — Agents fundamentally disagree.**
    For each agent, state: Agent name (their confidence): their position.
    End with: "This is a decision you should make yourself, not delegate to the council."

## Step 4: Save synthesis

Write your synthesis to `$SESSION_DIR/synthesis.json`:

```json
{
  "chairman": "claude",
  "consensus": "...",
  "divergence": "...",
  "recommendation": "...",
  "confidence": "high|medium|low",
  "timestamp": "ISO 8601"
}
```

## Step 5: Regenerate the viewer

After writing synthesis.json, regenerate the viewer so it includes your verdict:

```bash
$COUNCIL_BIN regenerate-viewer "$(basename "$SESSION_DIR")" --project "$SLUG"
```

## Step 6: Offer the viewer

Tell the user: "Council viewer saved to: $SESSION_DIR/viewer.html — open in browser to explore the full deliberation."
