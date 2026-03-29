# Agent Council

Convene a panel of CLI-based AI agents to deliberate on your questions. Three models answer independently, review each other's work, and the invoking agent synthesizes the verdict as chairman.

Works with **Claude Code**, **Codex CLI**, and **Gemini CLI**. Whichever tool you invoke from becomes the chairman. The others are council members.

Inspired by [Karpathy's LLM Council](https://github.com/karpathy/llm-council), adapted for the CLI agent ecosystem.

```
/council "Should we use Postgres or DynamoDB for our event sourcing system?"
```

```
Dispatching Stage 1 to 3 agents in parallel...
  - claude (timeout: 120s)
  - codex (timeout: 120s)
  - gemini (timeout: 180s)
  claude responded (38.2s)
  codex responded (52.1s)
  Quorum reached (2/3). Giving stragglers 30s grace...
  gemini responded (64.7s)
  All 3 agents responded.

Stage 1 complete: 3/3 successful opinions

--- CHAIRMAN SYNTHESIS (claude) ---

### Consensus
All agents agree: Postgres is the right choice given strong consistency
requirements and team SQL experience.

### Divergence
Claude emphasizes ACID guarantees as non-negotiable for account balances.
Codex flags a scaling ceiling at ~10TB without sharding.
Gemini suggests read replicas as a scaling bridge.

### Confidence
HIGH — Strong consensus across models.
```

## Why Agent Council?

**Every existing LLM council is API-call-based.** Karpathy's LLM Council, Perplexity Model Council, Council AI... they all pass text through API endpoints. Agent Council is different:

1. **Grounded deliberation.** Council members are CLI agents with tool access. They can `grep` your codebase, read migration files, run `git log`. Opinions are grounded in your actual project, not abstract text generation.

2. **Zero marginal cost.** You're tapping into subscriptions you already have (Claude Code, Codex, Gemini CLI). No new API tokens to buy.

3. **Living decisions.** Every deliberation is a hypothesis that can be re-evaluated. "We chose Postgres 3 months ago... re-run with what we know now." Use `/council-revisit` to compare then vs now.

## Quick Start

### Install via npm

```bash
npx cliagent-council
```

This clones the repo, installs skills for all detected CLI agents, and you're ready to go.

### Or install manually

```bash
git clone https://github.com/yogirk/agent-council.git
cd agent-council
./setup
```

**Platform:** macOS and Linux. Windows users: use [WSL](https://learn.microsoft.com/en-us/windows/wsl/).

**Requirements:** [Bun](https://bun.sh) + at least 2 of these CLI agents:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) — skills install to `~/.claude/skills/`
- [OpenAI Codex](https://github.com/openai/codex) (`codex`) — skills install to `~/.agents/skills/`
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`) — skills install to `~/.gemini/skills/`

## Usage

### As a skill (Claude Code, Codex CLI, Gemini CLI)

The same slash commands work in all three CLIs. The invoking agent automatically becomes the chairman.

```
/council "Should we use WebSockets or SSE for real-time updates?"
/council --with-review "Review auth middleware for security issues"
/council --quick "What's the best job queue for Node.js?"

/council-list                              # List all past sessions
/council-replay council-20260329-143000    # Replay a session in terminal
/council-revisit council-20260329-143000   # Re-run with current context (living decisions)
/council-outcome council-20260329-143000 "It worked great"  # Record outcome
```

When invoked from Claude Code, Claude is chairman. From Codex, Codex is chairman. From Gemini, Gemini is chairman. The chairman gives its own independent opinion in Stage 1, then synthesizes all opinions in Stage 3.

### From the command line
```bash
# Fast mode (default): opinions + synthesis
bin/council --question-file question.txt --project myapp

# Specify chairman explicitly (auto-detected if omitted)
bin/council --question-file question.txt --chairman codex --project myapp

# With peer review
bin/council --question-file question.txt --project myapp --with-review

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

**Stage 1:** ALL agents (including the chairman) answer independently, in parallel. Each gets your question + codebase context. No visibility into what others are producing. Once a quorum of opinions arrives, a grace window starts for slower agents.

**Stage 2** (optional): Each agent reviews the others' anonymized opinions. Scores them on correctness, completeness, and feasibility. Produces a ranking.

**Stage 3:** The chairman (whichever CLI you invoked from) reads all opinions (including its own from Stage 1) and synthesizes: where they agree, where they diverge, and a final recommendation with confidence level. When agents fundamentally disagree, the synthesis flags it explicitly with per-agent confidence so you can decide.

## Configuration

Create `~/.council/config.json` to customize models, timeouts, and quorum behavior:

```json
{
  "models": {
    "claude": "claude-opus-4-6",
    "codex": "gpt-5.4",
    "gemini": "gemini-3.1-pro"
  },
  "timeout_ms": {
    "claude": 120000,
    "codex": 120000,
    "gemini": 180000
  },
  "quorum_grace_ms": 30000
}
```

All fields are optional. Missing fields use the defaults shown above.

- **timeout_ms**: Per-agent timeout in milliseconds. Gemini defaults to 180s (it's slower). Can also be a single number applied to all agents.
- **quorum_grace_ms**: Once enough agents respond (quorum), stragglers get this grace window before the council proceeds without them. Default: 30s.

## Storage

Council sessions are stored in `~/.council/{project}/`. Each session contains:
- `meta.json` — question, agents, mode, timestamp
- `stage1/opinion_*.json` — individual agent opinions
- `stage2/review_*.json` — peer reviews (if `--with-review`)
- `synthesis.json` — chairman's final verdict
- `viewer.html` — interactive viewer (open in browser)

## Viewer

Every council session generates a self-contained HTML viewer. Open it in your browser to explore:

- **Verdict-first layout** with KPI strip (agents, consensus, confidence, wall clock)
- **Progressive depth**: recommendation always visible, then Reasoning / Trade-offs / Full Response as tabbed layers
- **Light and dark mode** with toggle (respects system preference)
- **Agent identity** via colored geometric icons (⬢ Claude, ⬣ Codex, ◆ Gemini)
- **Outcome banners** when a decision outcome has been recorded
- **Revisit comparison** side-by-side when viewing a revisited session
- **DM Sans typography**, responsive layout, XSS-safe rendering

## Does It Work?

We ran 3 benchmark questions through the council and compared against a single agent (Claude Opus 4.6). The council consistently found more considerations:

| Benchmark | Single Agent | Council | Delta |
|-----------|-------------|---------|-------|
| Database choice (Postgres vs DynamoDB) | 1/5 (20%) | 3/5 (60%) | +2 |
| Error handling (exceptions vs Result types) | 0/5 (0%) | 1/5 (20%) | +1 |
| Deployment (Kubernetes vs Docker Compose vs PaaS) | 3/5 (60%) | 4/5 (80%) | +1 |
| **Average** | **27%** | **53%** | **+1.3** |

The council found nearly 2x as many expected considerations. This measures consideration coverage (did the response mention scaling? cost? team experience?), not answer quality. Run your own eval: `bun run eval/run-eval.ts --dry-run` to see all 10 benchmarks.

## Proactive Suggestions

Agent Council can suggest `/council` when it detects you're making a decision with trade-offs. After setup, an ambient skill watches for patterns like:

- "should we use X or Y" → suggests `/council`
- Referencing past decisions → suggests `/council-revisit`
- Old council sessions without outcomes → suggests `/council-outcome`

Suggestions are quiet (a single line after the response), max 2 per session, and never interrupt your flow. Disable in `~/.council/config.json`:

```json
{ "proactive": false }
```

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

- **v0.1.0** (done): Three-stage deliberation, 3 adapters, redesigned viewer, cross-platform skills (Claude Code + Codex + Gemini), living decisions, outcome tracking, security hardening, progressive output, proactive nudge system, evaluation benchmarks
- **Next:** Shareable deliberation exports, calibration profiles (which model is best at what), `council.ts` modular refactor

## License

MIT
