import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
  copilotAdapter,
  detectAgents,
} from "../src/adapters";

const fixturesDir = resolve(import.meta.dir, "fixtures");

// --- Claude Adapter ---

describe("claudeAdapter", () => {
  test("parseOutput: valid JSON extracts result text", () => {
    const stdout = readFileSync(resolve(fixturesDir, "claude-output.json"), "utf-8");
    const result = claudeAdapter.parseOutput(stdout, "", 0, 2500);

    expect(result.status).toBe("ok");
    expect(result.agent).toBe("claude");
    expect(result.response).toContain("Hello");
    expect(result.duration_ms).toBe(2500);
    expect(result.model).toBeDefined();
  });

  test("parseOutput: malformed JSON returns error envelope", () => {
    const result = claudeAdapter.parseOutput("{broken json", "", 0, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("JSON parse failed");
    expect(result.raw_response).toBe("{broken json");
  });

  test("parseOutput: empty stdout returns error envelope", () => {
    const result = claudeAdapter.parseOutput("", "", 0, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("JSON parse failed");
  });

  test("parseOutput: non-zero exit code returns error", () => {
    const result = claudeAdapter.parseOutput("", "auth failed", 1, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("Exit code 1");
    expect(result.raw_stderr).toBe("auth failed");
  });

  test("command returns correct CLI args", () => {
    const cmd = claudeAdapter.command("test question", "/repo");
    expect(cmd).toEqual(["claude", "-p", "test question", "--output-format", "json"]);
  });
});

// --- Codex Adapter ---

describe("codexAdapter", () => {
  test("parseOutput: valid JSONL extracts item.completed text", () => {
    const stdout = readFileSync(resolve(fixturesDir, "codex-output.jsonl"), "utf-8");
    const result = codexAdapter.parseOutput(stdout, "", 0, 5000);

    expect(result.status).toBe("ok");
    expect(result.agent).toBe("codex");
    expect(result.response).toContain("Hello");
    expect(result.duration_ms).toBe(5000);
  });

  test("parseOutput: malformed JSONL skips bad lines", () => {
    const stdout = '{"type":"thread.started"}\n{broken}\n{"type":"item.completed","item":{"text":"Result"}}\n';
    const result = codexAdapter.parseOutput(stdout, "", 0, 100);

    expect(result.status).toBe("ok");
    expect(result.response).toBe("Result");
  });

  test("parseOutput: empty stdout returns error", () => {
    const result = codexAdapter.parseOutput("", "", 0, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("No item.completed events");
  });

  test("parseOutput: JSONL with no item.completed returns error", () => {
    const stdout = '{"type":"thread.started"}\n{"type":"turn.started"}\n';
    const result = codexAdapter.parseOutput(stdout, "", 0, 100);

    expect(result.status).toBe("error");
  });

  test("command returns correct CLI args", () => {
    const cmd = codexAdapter.command("test question", "/repo");
    expect(cmd).toEqual(["codex", "exec", "test question", "-C", "/repo", "-s", "read-only", "--json"]);
  });
});

// --- Gemini Adapter ---

describe("geminiAdapter", () => {
  test("parseOutput: valid JSON extracts response text", () => {
    const stdout = readFileSync(resolve(fixturesDir, "gemini-output.json"), "utf-8");
    const result = geminiAdapter.parseOutput(stdout, "", 0, 3000);

    expect(result.status).toBe("ok");
    expect(result.agent).toBe("gemini");
    expect(result.response).toContain("Hello");
    expect(result.duration_ms).toBe(3000);
  });

  test("parseOutput: malformed JSON returns error envelope", () => {
    const result = geminiAdapter.parseOutput("not json", "", 0, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("JSON parse failed");
  });

  test("parseOutput: empty stdout returns error", () => {
    const result = geminiAdapter.parseOutput("", "", 0, 100);

    expect(result.status).toBe("error");
  });

  test("command returns correct CLI args", () => {
    const cmd = geminiAdapter.command("test question", "/repo");
    expect(cmd).toEqual(["gemini", "-p", "test question", "-o", "json"]);
  });
});

// --- Copilot Adapter ---

describe("copilotAdapter", () => {
  test("parseOutput: valid JSONL extracts assistant.message content", () => {
    const stdout = readFileSync(resolve(fixturesDir, "copilot-output.jsonl"), "utf-8");
    const result = copilotAdapter.parseOutput(stdout, "", 0, 4000);

    expect(result.status).toBe("ok");
    expect(result.agent).toBe("copilot");
    expect(result.response).toContain("Hello");
    expect(result.duration_ms).toBe(4000);
    expect(result.model).toBe("claude-sonnet-4.5");
  });

  test("parseOutput: malformed JSONL skips bad lines", () => {
    const stdout = '{"type":"session.tools_updated","data":{"model":"gpt-5.2"}}\n{broken}\n{"type":"assistant.message","data":{"content":"Result"}}\n';
    const result = copilotAdapter.parseOutput(stdout, "", 0, 100);

    expect(result.status).toBe("ok");
    expect(result.response).toBe("Result");
    expect(result.model).toBe("gpt-5.2");
  });

  test("parseOutput: empty stdout returns error", () => {
    const result = copilotAdapter.parseOutput("", "", 0, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("No assistant.message events");
  });

  test("parseOutput: JSONL with no assistant.message returns error", () => {
    const stdout = '{"type":"session.mcp_servers_loaded","data":{}}\n{"type":"result","exitCode":0}\n';
    const result = copilotAdapter.parseOutput(stdout, "", 0, 100);

    expect(result.status).toBe("error");
  });

  test("parseOutput: non-zero exit code with no stdout returns error", () => {
    const result = copilotAdapter.parseOutput("", "auth failed", 1, 100);

    expect(result.status).toBe("error");
    expect(result.error).toContain("Exit code 1");
    expect(result.raw_stderr).toBe("auth failed");
  });

  test("parseOutput: concatenates multiple assistant.message events", () => {
    const stdout = [
      '{"type":"assistant.message","data":{"content":"First part. "}}',
      '{"type":"assistant.message","data":{"content":"Second part."}}',
    ].join("\n");
    const result = copilotAdapter.parseOutput(stdout, "", 0, 100);

    expect(result.status).toBe("ok");
    expect(result.response).toBe("First part. Second part.");
  });

  test("command returns correct CLI args", () => {
    const cmd = copilotAdapter.command("test question", "/repo");
    expect(cmd).toEqual([
      "copilot", "-p", "test question",
      "--output-format", "json", "-s",
      "--allow-all-tools", "--no-ask-user",
      "--no-custom-instructions",
    ]);
  });
});

// --- Structured Section Parsing ---

describe("structured section parsing", () => {
  test("parses all structured sections", () => {
    const structuredResponse = `### Recommendation
Use Postgres for strong consistency.

### Reasoning
- Team has SQL experience
- Strong ACID guarantees
- Better tooling ecosystem

### Trade-offs
Scaling ceiling around 10TB without sharding.

### Confidence
High — clear fit for the requirements.

### Dissent Points
DynamoDB would scale more easily if write volume triples.`;

    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: structuredResponse, modelUsage: { "claude-opus-4-6": {} } }),
      "",
      0,
      1000
    );

    expect(result.structured).toBe(true);
    expect(result.recommendation).toContain("Postgres");
    expect(result.reasoning).toHaveLength(3);
    expect(result.tradeoffs).toContain("10TB");
    expect(result.confidence).toContain("High");
    expect(result.dissent_points).toContain("DynamoDB");
  });

  test("handles unstructured response", () => {
    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: "Just use Postgres, it's fine.", modelUsage: {} }),
      "",
      0,
      1000
    );

    expect(result.structured).toBe(false);
    expect(result.response).toBe("Just use Postgres, it's fine.");
  });
});

// --- Agent Detection ---

describe("detectAgents", () => {
  test("returns at least some agents on this machine", async () => {
    const agents = await detectAgents();
    // We know all 4 are installed on this machine from preflight
    expect(agents.length).toBeGreaterThanOrEqual(2);
  });
});
