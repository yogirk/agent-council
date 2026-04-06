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
}

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
  raw_stderr?: string;
  duration_ms: number;
  timestamp: string;
}

export interface AgentAdapter {
  id: AgentId;
  binary: string;
  detect(): Promise<boolean>;
  command(prompt: string, repoRoot: string): string[];
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

function parseStructuredSections(text: string): {
  structured: boolean;
  recommendation?: string;
  reasoning?: string[];
  tradeoffs?: string;
  confidence?: string;
  dissent_points?: string;
} {
  const sections: Record<string, string> = {};
  const sectionPattern = /^###\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const positions: { name: string; start: number }[] = [];

  while ((match = sectionPattern.exec(text)) !== null) {
    positions.push({ name: match[1].trim().toLowerCase(), start: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start - positions[i + 1].name.length - 5 : text.length;
    sections[positions[i].name] = text.slice(positions[i].start, end).trim();
  }

  const hasRecommendation = "recommendation" in sections;
  const hasReasoning = "reasoning" in sections;

  if (!hasRecommendation && !hasReasoning) {
    return { structured: false };
  }

  const reasoningLines = sections["reasoning"]
    ?.split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return {
    structured: true,
    recommendation: sections["recommendation"],
    reasoning: reasoningLines,
    tradeoffs: sections["trade-offs"] || sections["tradeoffs"],
    confidence: sections["confidence"],
    dissent_points: sections["dissent points"] || sections["dissent_points"],
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

  command(prompt: string, repoRoot: string): string[] {
    return ["codex", "exec", prompt, "-C", repoRoot, "-s", "read-only", "--json"];
  },

  parseOutput(stdout, stderr, exitCode, durationMs) {
    if (exitCode !== 0 && !stdout.trim()) {
      return makeError("codex", `Exit code ${exitCode}`, stderr, durationMs);
    }
    try {
      const lines = stdout.trim().split("\n").filter(Boolean);
      let responseText = "";

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.text) {
            responseText += event.item.text;
          }
        } catch {
          // Skip unparseable lines (e.g., partial output on timeout)
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
// Output: single JSON object with .response field containing the text response

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  binary: "gemini",

  detect: () => binaryExists("gemini"),

  command(prompt: string): string[] {
    return ["gemini", "-p", prompt, "-o", "json"];
  },

  parseOutput(stdout, stderr, exitCode, durationMs) {
    if (exitCode !== 0) {
      return makeError("gemini", `Exit code ${exitCode}`, stderr, durationMs);
    }
    try {
      const parsed = JSON.parse(stdout);
      const text = parsed.response || "";
      if (!text) {
        return makeError("gemini", "Empty response field", stderr, durationMs);
      }
      return makeResult("gemini", text, durationMs);
    } catch (e: any) {
      return {
        agent: "gemini",
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
