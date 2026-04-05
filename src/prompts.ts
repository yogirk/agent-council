export function stage1Prompt(question: string, context: string): string {
  return `You are one member of an engineering council deliberating on a question.
Provide your independent analysis. Do not hedge or defer — take a position.

## Question
${question}

${context ? `## Project Context\n${context}\n` : ""}
## Response Format
Structure your response as:

### Recommendation
Your clear recommendation (1-2 sentences).

### Reasoning
Why this is the right approach (3-5 bullets).

### Assumptions
What facts did you assume about this project, team, or constraints that, if wrong, would change your recommendation? List 2-4 assumptions.

### Trade-offs
What you're giving up with this choice.

### Confidence
High / Medium / Low — and what would change your mind.

### What Would Change My Mind
Name the single most important fact that, if true, would make you switch to a different recommendation entirely.

### Dissent Points
If a reasonable engineer disagreed, what would their strongest argument be?`;
}

export function stage2Prompt(
  question: string,
  anonymizedOpinions: string
): string {
  return `You are reviewing anonymous responses to this engineering question:

## Question
${question}

## Responses
${anonymizedOpinions}

For each response, score (1-5):
- Correctness: Is the technical reasoning sound?
- Completeness: Does it address all aspects of the question?
- Feasibility: Can this actually be built/implemented as described?

Then provide a FINAL RANKING (best to worst) with one-line justification per response.

## Response Format
Structure your response as:

### Review of Response A
Correctness: X/5
Completeness: X/5
Feasibility: X/5
Notes: ...

### Review of Response B
(same format)

### Final Ranking
1. Response X — reason
2. Response Y — reason`;
}

export function stage4NudgePrompt(
  question: string,
  originalResponse: string,
  correction: string
): string {
  return `You previously answered this engineering question:

## Original Question
${question}

## Your Previous Response
${originalResponse}

## Correction from the human
The human is telling you that one of your assumptions was wrong:
${correction}

Given this correction, reconsider your recommendation. Be explicit about
what changed and what stayed the same. Structure your response as:

### What Changed
How does this correction affect your recommendation?

### Updated Recommendation
Your revised recommendation (or state "Unchanged" if the correction
doesn't affect your conclusion).

### Assumptions
Your revised assumptions list.

### Reasoning
Updated reasoning (3-5 bullets).

### Trade-offs
Updated trade-offs.

### Updated Confidence
Has your confidence changed? Why?`;
}

export function stage3Prompt(
  question: string,
  opinions: string,
  rankings?: string
): string {
  return `You are the chairman of an engineering council. You have your own
conversation context with the user, plus independent opinions from
other council members.

## Original Question
${question}

## Council Opinions
${opinions}

${rankings ? `## Peer Review Rankings\n${rankings}\n` : ""}
Synthesize a final answer. If agents fundamentally disagree (not just different
emphasis, but contradictory recommendations), flag it explicitly.

Structure your response as:

### Consensus
Where all agents agree.

### Divergence
Where agents disagree. State each position fairly with the agent name.

### Recommendation
Your synthesized answer drawing from the strongest elements.

### Confidence
- If all agents agree: **HIGH** — Strong consensus across models.
- If majority agrees: **MEDIUM** — Majority view with notable dissent.
- If agents fundamentally disagree: **LOW — Agents fundamentally disagree.**
  For each agent, state: Agent name (their self-reported confidence): their position.
  End with: "This is a decision you should make yourself, not delegate to the council."`;
}
