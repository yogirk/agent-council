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
  test("generates valid HTML with v2 design", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Agent Council");
    expect(html).toContain("council-20260329-120000");
    expect(html).toContain("--font-display");
    expect(html).not.toContain(".innerHTML");
  });

  test("renders tabbed opinions layout", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex"), mockOpinion("gemini")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("opinions-tabs");
    expect(html).toContain("opinion-panel");
    expect(html).toContain("agent-card-body");
  });

  test("renders meta strip and verdict", () => {
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

    expect(html).toContain("meta-strip");
    expect(html).toContain("verdict");
    expect(html).toContain("Verdict");
  });

  test("includes dark mode toggle and CSS variables", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("theme-toggle");
    expect(html).toContain('[data-theme="dark"]');
    expect(html).toContain("prefers-color-scheme");
  });

  test("includes reasoning and transcript sections", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("agent-sub-label");
    expect(html).toContain("Reasoning");
    expect(html).toContain("transcript-toggle");
    expect(html).toContain("transcript-body");
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

  test("renders without synthesis (no crash)", () => {
    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    // Should still have the basic structure even without synthesis
    expect(html).toContain("Agent Council");
    expect(html).toContain("renderVerdict");
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

  test("shows outcome data when outcome exists", () => {
    const meta = mockMeta({ outcome: { result: "It worked great", recorded_at: "2026-04-15T10:00:00Z" } });
    generateViewer(tmpDir, meta, [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("outcome");
    expect(html).toContain("It worked great");
  });

  test("includes nudges when stage4 exists", () => {
    mkdirSync(resolve(tmpDir, "stage4"), { recursive: true });
    writeFileSync(resolve(tmpDir, "stage4", "nudge_gemini.json"), JSON.stringify({
      agent: "gemini",
      status: "ok",
      recommendation: "Updated recommendation",
      confidence: "high",
      what_changed: "Fixed the storage engine name",
      response: "Full response text",
      duration_ms: 8000,
      nudge_meta: {
        correction: "ClickHouse uses MergeTree, not LSM-tree",
        original_recommendation: "Original recommendation",
        timestamp: "2026-03-29T19:48:22Z",
      },
    }));

    generateViewer(tmpDir, mockMeta(), [mockOpinion("codex")]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("MergeTree");
    expect(html).toContain("Updated recommendation");
  });

  test("includes assumptions and belief_update_trigger in viewerData", () => {
    const opinion = mockOpinion("codex");
    (opinion as any).assumptions = ["The workload is OLAP"];
    (opinion as any).belief_update_trigger = "If point lookups matter more";

    generateViewer(tmpDir, mockMeta(), [opinion]);
    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");

    expect(html).toContain("The workload is OLAP");
    expect(html).toContain("If point lookups matter more");
  });
});
