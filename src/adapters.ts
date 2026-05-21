import { resolve } from "path";

// --- Types ---

export type AgentId = "claude" | "codex" | "gemini";

export interface SessionOutcome {
  result: string;
  recorded_at: string;
}

export interface SessionMeta {
  id: string;
  question: string;
  project: string;
  chairman: AgentId;
  members: AgentId[];
  mode: "fast" | "thorough" | "quick";
  created_at: string;
  context_files: string[];
  parent_id: string | null;
  revisits: string[];
  outcome?: SessionOutcome;
  schema_version?: number;
}

export type ErrorClass = "auth" | "rate_limit" | "timeout" | "parse" | "startup" | "unknown";

export interface AgentResult {
  agent: AgentId;
  model?: string;
  status: "ok" | "error" | "timeout";
  structured: boolean;
  response: string;
  recommendation?: string;
  reasoning?: string[];
  assumptions?: string[];
  belief_update_trigger?: string;
  tradeoffs?: string;
  confidence?: string;
  dissent_points?: string;
  raw_response?: string;
  error?: string;
  error_class?: ErrorClass;
  raw_stderr?: string;
  duration_ms: number;
  timestamp: string;
}

export interface PreflightStatus {
  agent: AgentId;
  status: "ready" | "degraded" | "down";
  reason?: string;
}

export interface AgentAdapter {
  id: AgentId;
  binary: string;
  detect(): Promise<boolean>;
  command(prompt: string, repoRoot: string): string[];
  // PATCH 2026-05-21: optional stdin-piped prompt. When true, dispatchAgent
  // pipes the prompt over stdin instead of embedding it in argv. Codex on
  // Windows silently corrupts multi-line prompts passed as argv via
  // Bun.spawn (the prompt reaches codex but it parses only the first line),
  // so codex must use stdin. See council-20260521-050310 for the failure
  // trace where codex received the question but responded "what question?".
  stdinPrompt?: boolean;
  parseOutput(
    stdout: string,
    stderr: string,
    exitCode: number,
    durationMs: number
  ): AgentResult;
}

// --- Shared helpers ---

async function binaryExists(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

// --- Error classification ---

export function classifyError(stderr: string): ErrorClass {
  const lower = stderr.toLowerCase();
  if (/\b(auth|login|unauthorized|unauthenticated|api.?key)\b/.test(lower)) return "auth";
  if (/\b(token expired|invalid token|token revoked|access token)\b/.test(lower)) return "auth";
  if (/\b(rate.?limit|quota|too many requests|429)\b/.test(lower)) return "rate_limit";
  if (/\b(timeout|timed?\s*out|deadline)\b/.test(lower)) return "timeout";
  if (/\b(json|parse|syntax error|unexpected token)\b/.test(lower)) return "parse";
  if (/\b(not found|no such file|enoent|permission denied|cannot execute|spawn)\b/.test(lower)) return "startup";
  return "unknown";
}

export function errorClassMessage(errorClass: ErrorClass, agent: AgentId): string {
  switch (errorClass) {
    case "auth": return `${agent} authentication expired. Run \`${agent} login\` to fix.`;
    case "rate_limit": return `${agent} rate limited. Try again in a few minutes.`;
    case "timeout": return `${agent} timed out.`;
    case "parse": return `${agent} response was not valid JSON.`;
    case "startup": return `${agent} failed to start. Check installation.`;
    case "unknown": return `${agent} failed.`;
  }
}

// --- Preflight health check ---

export async function preflightCheck(
  adapter: AgentAdapter,
  repoRoot: string,
  // PATCH 2026-05-12: bumped from 15s → 60s. Windows native (non-WSL)
  // claude/gemini cold-start exceeds 15s when invoked from a Bun.spawn
  // subprocess (no TTY + CLAUDE.md memory load). 60s gives them room
  // without making preflight feel slow on the happy path.
  timeoutMs: number = 60_000
): Promise<PreflightStatus> {
  // Step 1: version check
  try {
    const vProc = Bun.spawn([adapter.binary, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const vExit = await vProc.exited;
    if (vExit !== 0) {
      return { agent: adapter.id, status: "down", reason: `${adapter.binary} --version exited with code ${vExit}` };
    }
  } catch {
    return { agent: adapter.id, status: "down", reason: `${adapter.binary} binary not found or not executable` };
  }

  // Step 2: no-op prompt to validate auth + output format
  try {
    const noOpPrompt = "Reply with just the word OK";
    const cmd = adapter.command(noOpPrompt, repoRoot);
    // PATCH 2026-05-21: mirror dispatchAgent stdin-piping behavior.
    const useStdin = adapter.stdinPrompt === true;
    const proc = Bun.spawn(cmd, {
      stdin: useStdin ? "pipe" : undefined,
      stdout: "pipe",
      stderr: "pipe",
      cwd: repoRoot,
    });
    if (useStdin && proc.stdin) {
      proc.stdin.write(noOpPrompt);
      proc.stdin.end();
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    if (timedOut) {
      return { agent: adapter.id, status: "degraded", reason: `No-op prompt timed out after ${timeoutMs / 1000}s` };
    }
    if (exitCode !== 0) {
      const ec = classifyError(stderr);
      return { agent: adapter.id, status: "degraded", reason: errorClassMessage(ec, adapter.id) };
    }
    return { agent: adapter.id, status: "ready" };
  } catch (e: any) {
    return { agent: adapter.id, status: "degraded", reason: e.message };
  }
}

// Fuzzy heading normalization: maps variant headings to canonical keys
const HEADING_ALIASES: Record<string, string> = {
  "recommendation": "recommendation",
  "updated recommendation": "recommendation",
  "reasoning": "reasoning",
  "trade-offs": "tradeoffs",
  "tradeoffs": "tradeoffs",
  "trade offs": "tradeoffs",
  "confidence": "confidence",
  "updated confidence": "confidence",
  "dissent points": "dissent_points",
  "dissent_points": "dissent_points",
  "strongest counter-argument": "dissent_points",
  "assumptions": "assumptions",
  "key assumptions": "assumptions",
  "my assumptions": "assumptions",
  "updated assumptions": "assumptions",
  "what would change my mind": "belief_update_trigger",
  "belief update trigger": "belief_update_trigger",
  "change my mind": "belief_update_trigger",
  "what changed": "what_changed",
};

function normalizeHeading(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return HEADING_ALIASES[lower] || lower;
}

function parseBulletList(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [text.trim()];
}

export function parseStructuredSections(text: string): {
  structured: boolean;
  recommendation?: string;
  reasoning?: string[];
  tradeoffs?: string;
  confidence?: string;
  dissent_points?: string;
  assumptions?: string[];
  belief_update_trigger?: string;
  what_changed?: string;
} {
  const sections: Record<string, string> = {};
  const sectionPattern = /^###\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const positions: { name: string; start: number }[] = [];

  while ((match = sectionPattern.exec(text)) !== null) {
    positions.push({
      name: normalizeHeading(match[1]),
      start: match.index + match[0].length,
      headingStart: match.index,
    });
  }

  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].headingStart : text.length;
    sections[positions[i].name] = text.slice(positions[i].start, end).trim();
  }

  const hasRecommendation = "recommendation" in sections;
  const hasReasoning = "reasoning" in sections;

  if (!hasRecommendation && !hasReasoning) {
    return { structured: false };
  }

  return {
    structured: true,
    recommendation: sections["recommendation"],
    reasoning: sections["reasoning"] ? parseBulletList(sections["reasoning"]) : undefined,
    tradeoffs: sections["tradeoffs"],
    confidence: sections["confidence"],
    dissent_points: sections["dissent_points"],
    assumptions: sections["assumptions"] ? parseBulletList(sections["assumptions"]) : undefined,
    belief_update_trigger: sections["belief_update_trigger"],
    what_changed: sections["what_changed"],
  };
}

function makeResult(
  agent: AgentId,
  responseText: string,
  durationMs: number
): AgentResult {
  const parsed = parseStructuredSections(responseText);
  return {
    agent,
    status: "ok",
    structured: parsed.structured,
    response: responseText,
    recommendation: parsed.recommendation,
    reasoning: parsed.reasoning,
    tradeoffs: parsed.tradeoffs,
    confidence: parsed.confidence,
    dissent_points: parsed.dissent_points,
    assumptions: parsed.assumptions,
    belief_update_trigger: parsed.belief_update_trigger,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  };
}

function makeError(
  agent: AgentId,
  error: string,
  stderr: string,
  durationMs: number
): AgentResult {
  return {
    agent,
    status: "error",
    structured: false,
    response: "",
    error,
    raw_stderr: stderr,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  };
}

// --- Claude Adapter ---
// Output: single JSON object with .result field containing the text response

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  binary: "claude",

  detect: () => binaryExists("claude"),

  command(prompt: string): string[] {
    return ["claude", "-p", prompt, "--output-format", "json"];
  },

  parseOutput(stdout, stderr, exitCode, durationMs) {
    if (exitCode !== 0) {
      return makeError("claude", `Exit code ${exitCode}`, stderr, durationMs);
    }
    try {
      const parsed = JSON.parse(stdout);
      const text = parsed.result || "";
      if (!text) {
        return makeError("claude", "Empty result field", stderr, durationMs);
      }
      const result = makeResult("claude", text, durationMs);
      result.model = Object.keys(parsed.modelUsage || {})[0] || undefined;
      return result;
    } catch (e: any) {
      return {
        agent: "claude",
        status: "error",
        structured: false,
        response: stdout,
        raw_response: stdout,
        error: `JSON parse failed: ${e.message}`,
        raw_stderr: stderr,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

// --- Codex Adapter ---
// Output: JSONL streaming. Look for item.completed events with item.text.

export const codexAdapter: AgentAdapter = {
  id: "codex",
  binary: "codex",

  detect: () => binaryExists("codex"),

  // PATCH 2026-05-21: prompt is piped over stdin. See AgentAdapter.stdinPrompt
  // for the rationale (Bun.spawn argv-with-newlines corruption on Windows).
  stdinPrompt: true,

  command(_prompt: string, repoRoot: string): string[] {
    // PATCH 2026-05-21: disable `superpowers@openai-curated` plugin per-invocation.
    // That plugin auto-loads a `using-superpowers` skill that instructs codex to
    // call skills before answering ANY prompt, which derails the council turn —
    // codex spends the entire timeout reading SKILL.md files and never reaches
    // the actual question. See council-20260521-045053 for the failure trace.
    // Prompt is read from stdin (`-` placeholder).
    return [
      "codex",
      "exec",
      "-",
      "-C",
      repoRoot,
      "-s",
      "read-only",
      "--json",
      "-c",
      'plugins."superpowers@openai-curated".enabled=false',
    ];
  },

  parseOutput(stdout, stderr, exitCode, durationMs) {
    if (exitCode !== 0 && !stdout.trim()) {
      return makeError("codex", `Exit code ${exitCode}`, stderr, durationMs);
    }
    try {
      // PATCH 2026-05-12: codex on Windows occasionally emits its
      // response to stderr (mixed with banner) instead of stdout
      // JSONL. Scan BOTH streams for item.completed events.
      const allLines = (stdout + "\n" + stderr).split("\n").filter(Boolean);
      let responseText = "";

      for (const line of allLines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.text) {
            responseText += event.item.text;
          }
        } catch {
          // Skip unparseable lines (banner text, partial output, etc.)
        }
      }

      // Last-resort fallback: codex sometimes emits the agent reply as
      // plain text in stderr after the JSONL banner ("codex\n<reply>").
      // Capture text after the literal "codex\n" marker if no JSONL
      // item.completed was found.
      if (!responseText) {
        const codexMarker = stderr.indexOf("\ncodex\n");
        if (codexMarker !== -1) {
          const tail = stderr.slice(codexMarker + 7).trim();
          // Strip trailing "tokens used:" footer and the like
          const cut = tail.split(/\n(tokens used|ERROR codex_core)/)[0].trim();
          if (cut.length > 10) responseText = cut;
        }
      }

      if (!responseText) {
        return makeError(
          "codex",
          "No item.completed events with text found in JSONL",
          stderr,
          durationMs
        );
      }

      return makeResult("codex", responseText, durationMs);
    } catch (e: any) {
      return {
        agent: "codex",
        status: "error",
        structured: false,
        response: stdout,
        raw_response: stdout,
        error: `JSONL parse failed: ${e.message}`,
        raw_stderr: stderr,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

// --- Gemini Adapter ---
// PATCH 2026-05-12: gemini-cli `-o json` flag is unreliable on Windows
// (returns raw prose to stdout, no JSON wrapping). Take stdout as the
// response text directly. JSON parse retained as a graceful path for
// platforms where -o json works.

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  binary: "gemini",

  detect: () => binaryExists("gemini"),

  // PATCH 2026-05-21: gemini hits the same Bun.spawn argv-with-newlines
  // corruption codex did — receives prompt but parses only the first line
  // and asks "what's the question?". Stdin-piped reliably (gemini -p reads
  // stdin and appends -p, so we omit -p and let stdin be the full prompt).
  // See council-20260521-051019 for failure trace.
  stdinPrompt: true,

  command(_prompt: string): string[] {
    // -o json kept opportunistically — when it works, parseOutput
    // unwraps; when it doesn't, parseOutput falls back to raw text.
    // Prompt is read from stdin (no -p arg).
    return ["gemini", "-o", "json"];
  },

  parseOutput(stdout, stderr, exitCode, durationMs) {
    if (exitCode !== 0) {
      return makeError("gemini", `Exit code ${exitCode}`, stderr, durationMs);
    }
    // Strip gemini-cli warning lines from stdout that prepend the actual
    // response on Windows ("Warning: True color...", "Ripgrep is not...").
    const cleaned = stdout
      .split("\n")
      .filter((l) => !/^Warning:/i.test(l) && !/^Ripgrep is not available/i.test(l))
      .join("\n")
      .trim();
    if (!cleaned) {
      return makeError("gemini", "Empty stdout", stderr, durationMs);
    }
    // Try JSON parse first (proper -o json mode). When the JSON is
    // well-formed, it is authoritative: a missing/empty `response` field
    // means gemini emitted a diagnostic/error envelope, not an answer.
    // Raw-text fallback applies only when the payload isn't valid JSON
    // (e.g. gemini-cli printed prose directly, pre--o-json fallback path).
    try {
      const parsed = JSON.parse(cleaned);
      const text = typeof parsed.response === "string" ? parsed.response.trim() : "";
      if (text) return makeResult("gemini", text, durationMs);
      return makeError(
        "gemini",
        "JSON response missing or empty `response` field",
        stderr || cleaned.slice(0, 500),
        durationMs
      );
    } catch {
      // Not JSON — fall through to raw-text path.
    }
    // Raw-text fallback: take cleaned stdout as the response.
    return makeResult("gemini", cleaned, durationMs);
  },
};

// --- Agent Registry ---

export const allAdapters: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
];

export async function detectAgents(): Promise<AgentAdapter[]> {
  const results = await Promise.all(
    allAdapters.map(async (adapter) => ({
      adapter,
      available: await adapter.detect(),
    }))
  );

  return results.filter((r) => r.available).map((r) => r.adapter);
}
