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
  test("generates valid HTML with new layout", () => {
    const meta = mockMeta();
    generateViewer(tmpDir, meta, [mockOpinion("codex"), mockOpinion("gemini")]);

    const viewerPath = resolve(tmpDir, "viewer.html");
    expect(existsSync(viewerPath)).toBe(true);

    const html = readFileSync(viewerPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Agent Council");
    expect(html).toContain("council-20260329-120000");
    // No raw innerHTML usage
    expect(html).not.toContain(".innerHTML");
  });

  test("renders side-by-side agent cards", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("cards-grid");
    expect(html).toContain("agent-card");
    expect(html).toContain("card-accent-codex");
    expect(html).toContain("card-accent-gemini");
  });

  test("renders stage tabs", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("Opinions");
    expect(html).toContain("Reviews");
    expect(html).toContain("Synthesis");
    expect(html).toContain("tab-content");
  });

  test("renders summary bar with stats", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("summary-bar");
    expect(html).toContain("successCount");
  });

  test("includes synthesis when synthesis.json exists", () => {
    const meta = mockMeta();
    const synthesis = {
      chairman: "claude",
      consensus: "All agree on Postgres",
      divergence: "Codex flags scaling",
      recommendation: "Use Postgres with read replicas",
      confidence: "high",
      timestamp: new Date().toISOString(),
    };
    writeFileSync(resolve(tmpDir, "synthesis.json"), JSON.stringify(synthesis));

    generateViewer(tmpDir, meta, [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("Chairman Synthesis");
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
    expect(html).toContain("card-error");
  });

  test("escapes script-breaking content in JSON", () => {
    const meta = mockMeta({
      question: 'What about </script><script>alert("xss")</script>?',
    });
    const opinion = mockOpinion("codex");
    opinion.response = 'Use <script>evil()</script> carefully';

    generateViewer(tmpDir, meta, [opinion]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    // The </script> in data should be escaped
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  test("responsive grid class present", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("@media (max-width: 768px)");
    expect(html).toContain("grid-template-columns: 1fr");
  });
});
