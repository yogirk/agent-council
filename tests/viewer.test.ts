import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { generateViewer } from "../src/viewer";
import type { AgentResult, SessionMeta } from "../src/adapters";

const tmpDir = resolve(import.meta.dir, ".tmp-viewer-test");

beforeEach(() => {
  mkdirSync(resolve(tmpDir, "stage1"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function mockMeta(overrides?: Partial<SessionMeta>): SessionMeta {
  return {
    id: "council-20260329-120000",
    question: "Should we use Postgres or DynamoDB?",
    project: "test",
    chairman: "claude",
    members: ["codex", "gemini"],
    mode: "fast",
    created_at: new Date().toISOString(),
    context_files: [],
    parent_id: null,
    revisits: [],
    ...overrides,
  };
}

function mockOpinion(agent: string, status: "ok" | "error" = "ok"): AgentResult {
  return {
    agent: agent as any,
    status,
    structured: status === "ok",
    response: status === "ok" ? "### Recommendation\nUse Postgres.\n\n### Reasoning\n- Good fit\n- Strong consistency" : "",
    recommendation: status === "ok" ? "Use Postgres." : undefined,
    reasoning: status === "ok" ? ["Good fit", "Strong consistency"] : undefined,
    tradeoffs: status === "ok" ? "Scaling ceiling at 10TB" : undefined,
    confidence: status === "ok" ? "High" : undefined,
    dissent_points: status === "ok" ? "DynamoDB scales better" : undefined,
    error: status === "error" ? "Timeout after 120s" : undefined,
    duration_ms: 5000,
    timestamp: new Date().toISOString(),
  };
}

describe("generateViewer", () => {
  test("generates valid HTML with new design", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Agent Council");
    expect(html).toContain("council-20260329-120000");
    expect(html).toContain("DM Sans");
    expect(html).not.toContain(".innerHTML");
  });

  test("renders agent stack layout", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("agents-stack");
    expect(html).toContain("agent-msg");
    expect(html).toContain("agent-avatar");
  });

  test("renders KPI strip and verdict", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("kpi-strip");
    expect(html).toContain("verdict");
    expect(html).toContain("Council Verdict");
  });

  test("includes dark mode toggle and CSS variables", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("themeToggle");
    expect(html).toContain("html.dark");
    expect(html).toContain("prefers-color-scheme");
  });

  test("includes depth tabs (Reasoning, Trade-offs, Full Response)", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("depth-tabs");
    expect(html).toContain("Reasoning");
    expect(html).toContain("Trade-offs");
    expect(html).toContain("Full Response");
  });

  test("includes synthesis when synthesis.json exists", () => {
    const synthesis = {
      chairman: "claude",
      consensus: "All agree on Postgres",
      divergence: "Codex flags scaling",
      recommendation: "Use Postgres with read replicas",
      confidence: "high",
      timestamp: new Date().toISOString(),
    };
    writeFileSync(resolve(tmpDir, "synthesis.json"), JSON.stringify(synthesis));

    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("All agree on Postgres");
  });

  test("shows pending message when no synthesis", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("Synthesis pending");
  });

  test("handles error opinions", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex", "error")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("Timeout after 120s");
  });

  test("escapes script-breaking content in JSON", () => {
    const meta = mockMeta({ question: 'What about </script><script>alert("xss")</script>?' });
    const opinion = mockOpinion("codex");
    opinion.response = 'Use <script>evil()</script> carefully';

    generateViewer(tmpDir, meta, [opinion]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  test("responsive breakpoint present", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("@media (max-width: 768px)");
  });

  test("renders copilot agent with correct icon and class", () => {
    const meta = mockMeta({ members: ["codex", "gemini", "copilot"] });
    generateViewer(tmpDir, meta, [mockOpinion("codex"), mockOpinion("gemini"), mockOpinion("copilot")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("copilot");
    expect(html).toContain("\\u2b21");
    expect(html).toContain("--orange");
  });

  test("shows outcome banner when outcome exists", () => {
    const meta = mockMeta({ outcome: { result: "It worked great", recorded_at: "2026-04-15T10:00:00Z" } });
    generateViewer(tmpDir, meta, [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("outcome-banner");
    expect(html).toContain("It worked great");
  });
});
