# Agent Council

A Claude Code skill that convenes a panel of CLI-based AI agents (Claude Code, Codex, Gemini CLI) to deliberate on engineering problems through structured multi-stage discussion, peer review, and synthesis.

Inspired by [Karpathy's LLM Council](https://github.com/karpathy/llm-council), adapted for the CLI agent ecosystem.

## The Problem

No single AI agent is best at everything. When making architecture decisions, debugging complex issues, or evaluating trade-offs, a single model gives you a single perspective with no way to gauge confidence or blind spots. You get one opinion and have to trust it.

Current multi-agent skills in Claude Code don't solve this:

- **team-builder**: Spawns parallel agents, but all are Claude — same model family, same biases
- **santa-method**: Adversarial review pattern, but Claude reviewing Claude
- **dmux-workflows**: Cross-harness (Codex, Gemini), but manual tmux management with no deliberation protocol
- **devfleet**: Long-running mission DAGs, overkill for a focused question

There's no lightweight way to get **diverse model opinions with structured deliberation** on a specific engineering question.

## The Idea

### Three-Stage Deliberation Protocol

Adapted from Karpathy's LLM Council, but operating through CLI agents rather than API calls.

```
                    +------------------+
                    |   User Question  |
                    +--------+---------+
                             |
              Stage 1: Independent Opinions
                             |
            +----------------+----------------+
            |                |                |
      +-----------+    +-----------+    +-----------+
      | Claude    |    | Codex     |    | Gemini    |
      | Code      |    | CLI       |    | CLI       |
      +-----------+    +-----------+    +-----------+
            |                |                |
            v                v                v
      [Opinion A]      [Opinion B]      [Opinion C]
            |                |                |
            +----------------+----------------+
                             |
               Stage 2: Anonymized Peer Review
                             |
            +----------------+----------------+
            |                |                |
      +-----------+    +-----------+    +-----------+
      | Claude    |    | Codex     |    | Gemini    |
      | reviews   |    | reviews   |    | reviews   |
      | B and C   |    | A and C   |    | A and B   |
      +-----------+    +-----------+    +-----------+
            |                |                |
            v                v                v
       [Rankings]       [Rankings]       [Rankings]
            |                |                |
            +----------------+----------------+
                             |
                Stage 3: Chairman Synthesis
                             |
                    +--------+---------+
                    | Invoking agent   |
                    | (has full        |
                    |  conversation    |
                    |  context)        |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    |  Final Answer    |
                    |  with consensus  |
                    |  and dissent     |
                    +------------------+
```

### Stage 1: Independent Opinions

All council members receive the same prompt and work in parallel. Each agent answers independently with no visibility into what others are producing.

**Dispatch mechanism:** Bash-level parallel CLI execution.

```bash
# Parallel dispatch (conceptual)
claude -p "$prompt" --model claude-sonnet-4-5-20250514 > /tmp/council/opinion_a.md &
codex exec --model gpt-5.4 -o /tmp/council/opinion_b.md - < prompt.txt &
gemini --model gemini-2.5-pro < prompt.txt > /tmp/council/opinion_c.md &
wait
```

Each agent gets:
- The user's question/problem statement
- Relevant codebase context (file contents, directory structure)
- Instructions to provide a structured answer with reasoning

**Why CLI agents, not API calls:** CLI agents have tool access. They can read files, run commands, search the codebase. This makes council opinions grounded in the actual project, not just abstract text generation.

### Stage 2: Anonymized Peer Review (Optional)

Each agent receives all Stage 1 opinions with identities stripped ("Response A", "Response B", "Response C"). Each agent evaluates the others and produces a ranking.

**Review prompt template:**

```
You are reviewing responses to this engineering question:

{original_question}

Here are three independent responses:

## Response A
{opinion_a}

## Response B
{opinion_b}

## Response C
{opinion_c}

For each response, evaluate:
1. Technical correctness
2. Completeness of the solution
3. Trade-off analysis quality
4. Practical feasibility

Then provide a FINAL RANKING (best to worst) with brief justification.
```

**Anonymization is critical.** Without it, models may show provider bias (favoring their own family's response) or name-recognition bias. The label-to-model mapping is maintained only by the orchestrator.

**This stage is optional.** It roughly triples cost and latency. Default behavior:
- `agent-council "question"` — Stage 1 + Stage 3 only (fast mode)
- `agent-council --with-review "question"` — All three stages (thorough mode)

### Stage 3: Chairman Synthesis

The invoking agent (whichever CLI you're running the skill from) acts as chairman. This is a deliberate choice — the chairman has the full conversation context, understands the user's broader goals, and can weave the council's output back into the ongoing session.

The chairman receives:
- The original question
- All Stage 1 opinions (now with model names revealed)
- Stage 2 rankings (if available)
- Aggregate scoring

It produces:
- **Consensus view**: Where all agents agree
- **Points of divergence**: Where agents disagree, with each position stated fairly
- **Chairman's recommendation**: A synthesized answer drawing from the strongest elements
- **Confidence signal**: High (all agree), Medium (majority agrees), Low (significant disagreement)

## Practical Design

### Agent Configuration

```yaml
# Default council composition
council:
  members:
    - name: claude
      cli: claude
      args: ["-p", "--model", "claude-sonnet-4-5-20250514"]
      installed: auto-detect
    - name: codex
      cli: codex
      args: ["exec", "-p", "yolo", "--model", "gpt-5.4", "--color", "never"]
      installed: auto-detect
    - name: gemini
      cli: gemini
      args: ["--model", "gemini-2.5-pro"]
      installed: auto-detect
  chairman: invoking  # whichever CLI triggers the council
  min_members: 2      # proceed even if one CLI is not installed
```

Auto-detection: `which claude`, `which codex`, `which gemini` at invocation time. If only two are available, run with two. If only one is available, warn and suggest installing others.

### File-Based Handoff

All inter-agent communication happens through temp files. No shared memory, no sockets.

```
/tmp/agent-council/{session_id}/
  prompt.md              # Original question + context
  stage1/
    opinion_claude.md    # Claude's response
    opinion_codex.md     # Codex's response
    opinion_gemini.md    # Gemini's response
  stage2/                # Only if --with-review
    review_claude.md     # Claude's peer review
    review_codex.md      # Codex's peer review
    review_gemini.md     # Gemini's peer review
    rankings.json        # Parsed aggregate rankings
  stage3/
    synthesis.md         # Chairman's final output
```

### Context Injection

For engineering questions to be useful, agents need project context. The orchestrator prepares a context bundle:

```markdown
## Project Context

### Relevant Files
{files identified by the user or inferred from the question}

### Directory Structure
{tree output of relevant directories}

### Recent Git History
{last 10 commits if relevant}

### Question
{the user's actual question}
```

This context bundle is included in every Stage 1 prompt so all agents work from the same information.

### Progressive Output

Rather than waiting for all stages to complete:

1. Show a spinner while Stage 1 runs
2. Display each opinion as it arrives (agents finish at different speeds)
3. If `--with-review`, show another spinner for Stage 2
4. Display the chairman's synthesis as the final output

## Use Cases

### Architecture Decisions

```
/agent-council "Should we use PostgreSQL or DynamoDB for our event
sourcing system? We expect 10k events/sec write throughput, need
strong consistency for account balances, and the team has more
SQL experience."
```

Each agent brings different training data and biases about database trade-offs. The synthesis surfaces where they agree (probably: Postgres for strong consistency + team experience) and where they diverge (scalability ceiling, operational complexity).

### Code Review

```
/agent-council --with-review "Review this authentication middleware
for security issues. See auth/middleware.ts"
```

Three independent security reviews with peer ranking. More likely to catch subtle issues than any single model.

### Debugging

```
/agent-council "Our API latency spiked 3x after deploying commit abc123.
The diff is in the last commit. What's the most likely cause?"
```

Different models may form different hypotheses. The synthesis presents the top hypotheses ranked by council agreement.

### Technology Selection

```
/agent-council "We need a job queue for background processing in our
Node.js app. Requirements: at-least-once delivery, delayed jobs,
priority queues, Redis-backed. Compare BullMQ, Agenda, and bee-queue."
```

## What This Is Not

- **Not a replacement for single-agent work.** Most tasks don't need a council. Use this for decisions with meaningful trade-offs where diverse perspectives add value.
- **Not a code generation tool.** The council deliberates and recommends. It doesn't write code collaboratively (use devfleet or dmux for that).
- **Not cheap.** Even in fast mode (Stage 1 + 3), you're paying for N+1 model invocations. With peer review, it's 2N+1. Use deliberately.
- **Not real-time.** Expect 30-60 seconds for fast mode, 2-3 minutes with peer review. This is a "stop and think" tool.

## Comparison to Karpathy's LLM Council

| Aspect | LLM Council | Agent Council |
|--------|-------------|---------------|
| Interface | Web UI + OpenRouter API | CLI skill, terminal-native |
| Models | Text-only API calls | CLI agents with tool access |
| Scope | General questions | Engineering decisions |
| Context | User-provided text only | Codebase-aware (files, git, shell) |
| Peer review | Always on | Optional (`--with-review`) |
| Chairman | Fixed model (Gemini) | Invoking agent (has conversation context) |
| Persistence | JSON conversation files | Temp files per session |
| Integration | Standalone app | Composable with other skills |

## Open Questions

1. **Should council members be able to use tools during Stage 1?** Letting agents read files and run commands produces grounded opinions but increases latency and cost. Could offer `--deep` flag for tool-enabled opinions vs `--quick` for text-only.

2. **How to handle model-specific CLI quirks?** Each CLI has different flags, output formats, and error modes. Need an adapter layer or per-agent config.

3. **Should the skill persist council history?** Karpathy stores conversations as JSON. Could be useful for revisiting past decisions, but adds complexity.

4. **Can Stage 2 use a cheaper/faster model?** The peer review doesn't need the strongest model — ranking is simpler than generating. Could use Haiku/Flash for reviews to cut costs.

5. **Multi-turn deliberation?** Karpathy's council is single-turn. Could extend to allow a second round where agents respond to the peer reviews before the chairman synthesizes. Adds richness but doubles the cost again.

## Implementation Path

### Phase 1: Minimum Viable Council
- Skill file (`agent-council.md`) with the deliberation protocol
- Stage 1 + Stage 3 only (no peer review)
- Support Claude Code + one other CLI (Codex or Gemini)
- File-based handoff in /tmp
- Chairman is always the invoking agent

### Phase 2: Full Protocol
- Add Stage 2 (anonymized peer review) behind `--with-review`
- Support all three CLIs with auto-detection
- Aggregate ranking and scoring
- Progressive output

### Phase 3: Polish
- Council history/persistence
- Configurable council composition (add/remove members, pick models)
- Cost estimation before running
- Integration with other skills (e.g., council feeds into a plan)
