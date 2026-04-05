import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  claudeAdapter,
  codexAdapter,
  geminiAdapter,
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

  test("parses assumptions as bullet list", () => {
    const response = `### Recommendation
Use Postgres.

### Reasoning
- Good fit

### Assumptions
- Team will not exceed 10TB
- No need for global distribution
- Budget allows managed hosting

### What Would Change My Mind
If write volume exceeds 50k/sec sustained, DynamoDB becomes necessary.`;

    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: response, modelUsage: {} }),
      "",
      0,
      1000
    );

    expect(result.structured).toBe(true);
    expect(result.assumptions).toHaveLength(3);
    expect(result.assumptions![0]).toContain("10TB");
    expect(result.assumptions![2]).toContain("managed hosting");
    expect(result.belief_update_trigger).toContain("50k/sec");
  });

  test("parses assumptions as prose (fallback to single element)", () => {
    const response = `### Recommendation
Use Postgres.

### Reasoning
- Good fit

### Assumptions
The team has existing SQL expertise and the data model is relational.`;

    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: response, modelUsage: {} }),
      "",
      0,
      1000
    );

    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions![0]).toContain("SQL expertise");
  });

  test("fuzzy matches variant headings", () => {
    const response = `### Recommendation
Use Postgres.

### Reasoning
- Good fit

### Key Assumptions
- Team knows SQL
- Data is relational

### Trade-Offs
No auto-scaling.

### Strongest Counter-argument
MongoDB is more flexible.`;

    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: response, modelUsage: {} }),
      "",
      0,
      1000
    );

    expect(result.assumptions).toHaveLength(2);
    expect(result.tradeoffs).toContain("auto-scaling");
    expect(result.dissent_points).toContain("MongoDB");
  });

  test("missing assumptions returns undefined", () => {
    const response = `### Recommendation
Use Postgres.

### Reasoning
- Good fit`;

    const result = claudeAdapter.parseOutput(
      JSON.stringify({ result: response, modelUsage: {} }),
      "",
      0,
      1000
    );

    expect(result.assumptions).toBeUndefined();
    expect(result.belief_update_trigger).toBeUndefined();
  });
});

// --- Agent Detection ---

describe("detectAgents", () => {
  test("returns at least some agents on this machine", async () => {
    const agents = await detectAgents();
    // We know all 3 are installed on this machine from preflight
    expect(agents.length).toBeGreaterThanOrEqual(2);
  });
});
