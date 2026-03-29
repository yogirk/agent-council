# Agent Council

Convene a panel of CLI-based AI agents to deliberate on your engineering questions. Three models answer independently, review each other's work, and a chairman synthesizes the verdict.

Inspired by [Karpathy's LLM Council](https://github.com/karpathy/llm-council), adapted for the CLI agent ecosystem.

```
/council "Should we use Postgres or DynamoDB for our event sourcing system?"
```

```
Dispatching Stage 1 to 2 agents in parallel...
  - codex
  - gemini

Stage 1 complete: 2/2 successful opinions

--- CHAIRMAN SYNTHESIS (claude) ---

### Consensus
All agents agree: Postgres is the right choice given strong consistency
requirements and team SQL experience.

### Divergence
Codex flags a scaling ceiling at ~10TB without sharding.
Gemini suggests read replicas as a scaling bridge.

### Confidence
HIGH — Strong consensus across models.
```

## Why Agent Council?

**Every existing LLM council is API-call-based.** Karpathy's LLM Council, Perplexity Model Council, Council AI... they all pass text through API endpoints. Agent Council is different:

1. **Grounded deliberation.** Council members are CLI agents with tool access. They can `grep` your codebase, read migration files, run `git log`. Opinions are grounded in your actual project, not abstract text generation.

2. **Zero marginal cost.** You're tapping into subscriptions you already have (Claude Code, Codex, Gemini CLI). No new API tokens to buy.

3. **Living decisions.** Every deliberation is a hypothesis that can be re-evaluated. "We chose Postgres 3 months ago... re-run with what we know now." (Phase 2)

## Quick Start

```bash
git clone https://github.com/yogirk/agent-council.git
cd agent-council
./setup
```

Requirements: [Bun](https://bun.sh) + at least 2 of these CLI agents:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [OpenAI Codex](https://github.com/openai/codex) (`codex`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

## Usage

### From Claude Code (skill)
```
/council "Should we use WebSockets or SSE for real-time updates?"
/council --with-review "Review auth middleware for security issues"
/council --quick "What's the best job queue for Node.js?"
```

### From the command line
```bash
# Fast mode (default): opinions + synthesis
bin/council --question-file question.txt --chairman claude --project myapp

# With peer review
bin/council --question-file question.txt --chairman claude --project myapp --with-review

# Browse past sessions
bin/council list --project myapp
bin/council replay council-20260329-143000 --project myapp
```

## How It Works

```
                    +------------------+
                    |   Your Question  |
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
                        (optional: --with-review)
                             |
                Stage 3: Chairman Synthesis
                             |
                    +------------------+
                    |  Final Verdict   |
                    |  with consensus  |
                    |  and dissent     |
                    +------------------+
```

**Stage 1:** All agents answer independently, in parallel. Each gets your question + codebase context. No visibility into what others are producing.

**Stage 2** (optional): Each agent reviews the others' anonymized opinions. Scores them on correctness, completeness, and feasibility. Produces a ranking.

**Stage 3:** The chairman (whichever CLI you invoked from) synthesizes: where they agree, where they diverge, and a final recommendation with confidence level.

## Configuration

Create `~/.council/config.json` to customize models and timeout:

```json
{
  "models": {
    "claude": "claude-opus-4-6",
    "codex": "gpt-5.4",
    "gemini": "gemini-3.1-pro"
  },
  "timeout_ms": 120000
}
```

All fields are optional. Missing fields use the defaults shown above.

## Storage

Council sessions are stored in `~/.council/{project}/`. Each session contains:
- `meta.json` — question, agents, mode, timestamp
- `stage1/opinion_*.json` — individual agent opinions
- `stage2/review_*.json` — peer reviews (if `--with-review`)
- `synthesis.json` — chairman's final verdict
- `viewer.html` — interactive viewer (open in browser)

## Viewer

Every council session generates a self-contained HTML viewer. Open it in your browser to explore the full deliberation with expandable stages, confidence indicators, and duration timings.

## Use Cases

- **Architecture decisions:** "Postgres vs DynamoDB for event sourcing at 10k events/sec?"
- **Code review:** "Review this auth middleware for security issues"
- **Debugging:** "Our API latency spiked 3x after commit abc123. Most likely cause?"
- **Technology selection:** "Compare BullMQ, Agenda, and bee-queue for our Node.js job queue"
- **General questions:** Works for any question, not just engineering

## What This Is Not

- **Not a replacement for single-agent work.** Most tasks don't need a council. Use for decisions with meaningful trade-offs.
- **Not a code generation tool.** The council deliberates and recommends. It doesn't write code collaboratively.
- **Not cheap in time.** Expect 60-120 seconds for fast mode. This is a "stop and think" tool.
- **Not real-time.** Parallel dispatch helps, but CLI agents take time.

## Roadmap

- **Phase 1** (current): Working council with 3 adapters, viewer, Claude Code skill
- **Phase 2:** Living decisions (revisit past councils with new context), cross-platform chairman, outcome tracking, calibration profiles
- **Phase 3:** Shareable deliberation exports, community features

## License

MIT
