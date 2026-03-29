import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { generateViewer } from "../src/viewer";
import type { AgentResult } from "../src/adapters";

const tmpDir = resolve(import.meta.dir, ".tmp-viewer-test");

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function mockOpinion(agent: string, status: "ok" | "error" = "ok"): AgentResult {
  return {
    agent: agent as any,
    status,
    structured: status === "ok",
    response: status === "ok" ? "### Recommendation\nUse Postgres.\n\n### Reasoning\n- Good fit" : "",
    recommendation: status === "ok" ? "Use Postgres." : undefined,
    reasoning: status === "ok" ? ["Good fit"] : undefined,
    confidence: status === "ok" ? "High" : undefined,
    error: status === "error" ? "Timeout after 120s" : undefined,
    duration_ms: 5000,
    timestamp: new Date().toISOString(),
  };
}

describe("generateViewer", () => {
  test("generates valid HTML file", () => {
    const meta = {
      id: "council-20260329-120000",
      question: "Should we use Postgres or DynamoDB?",
      project: "test",
      chairman: "claude",
      members: ["codex", "gemini"],
      mode: "fast",
      created_at: new Date().toISOString(),
      context_files: [],
    };

    generateViewer(tmpDir, meta, [
      mockOpinion("codex"),
      mockOpinion("gemini"),
    ]);

    const viewerPath = resolve(tmpDir, "viewer.html");
    expect(existsSync(viewerPath)).toBe(true);

    const html = readFileSync(viewerPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Agent Council");
    expect(html).toContain("council-20260329-120000");
    // XSS check: data is in a script tag but escaped
    expect(html).toContain("const DATA =");
    // Verify no raw innerHTML usage
    expect(html).not.toContain(".innerHTML");
  });

  test("handles error opinions", () => {
    const meta = {
      id: "council-error-test",
      question: "Test question",
      project: "test",
      chairman: "claude",
      members: ["codex"],
      mode: "fast",
      created_at: new Date().toISOString(),
      context_files: [],
    };

    generateViewer(tmpDir, meta, [mockOpinion("codex", "error")]);

    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");
    expect(html).toContain("Timeout after 120s");
  });

  test("escapes script-breaking content in JSON", () => {
    const meta = {
      id: "council-xss-test",
      question: 'What about </script><script>alert("xss")</script>?',
      project: "test",
      chairman: "claude",
      members: ["codex"],
      mode: "fast",
      created_at: new Date().toISOString(),
      context_files: [],
    };

    const opinion = mockOpinion("codex");
    opinion.response = 'Use <script>evil()</script> carefully';

    generateViewer(tmpDir, meta, [opinion]);

    const html = readFileSync(resolve(tmpDir, "viewer.html"), "utf-8");
    // The </script> tag should be escaped in the JSON data
    expect(html).not.toContain('</script><script>');
    // But the actual closing script tag for our code should exist
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });
});
