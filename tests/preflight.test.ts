import { describe, test, expect } from "bun:test";
import { classifyError, errorClassMessage, type ErrorClass } from "../src/adapters";

describe("classifyError", () => {
  test("detects auth errors", () => {
    expect(classifyError("Error: unauthorized - invalid API key")).toBe("auth");
    expect(classifyError("Please login first")).toBe("auth");
    expect(classifyError("token expired")).toBe("auth");
    expect(classifyError("unauthenticated request")).toBe("auth");
  });

  test("detects rate limit errors", () => {
    expect(classifyError("Error: rate limit exceeded")).toBe("rate_limit");
    expect(classifyError("429 Too Many Requests")).toBe("rate_limit");
    expect(classifyError("quota exceeded for today")).toBe("rate_limit");
  });

  test("detects timeout errors", () => {
    expect(classifyError("Error: request timed out")).toBe("timeout");
    expect(classifyError("deadline exceeded")).toBe("timeout");
  });

  test("detects parse errors", () => {
    expect(classifyError("SyntaxError: Unexpected token")).toBe("parse");
    expect(classifyError("JSON parse error")).toBe("parse");
  });

  test("detects startup errors", () => {
    expect(classifyError("command not found")).toBe("startup");
    expect(classifyError("ENOENT: no such file or directory")).toBe("startup");
    expect(classifyError("permission denied")).toBe("startup");
    expect(classifyError("spawn ENOENT")).toBe("startup");
  });

  test("returns unknown for unrecognized patterns", () => {
    expect(classifyError("something went wrong")).toBe("unknown");
    expect(classifyError("")).toBe("unknown");
  });
});

describe("errorClassMessage", () => {
  test("returns actionable messages per error class", () => {
    expect(errorClassMessage("auth", "codex")).toContain("authentication expired");
    expect(errorClassMessage("auth", "codex")).toContain("codex login");
    expect(errorClassMessage("rate_limit", "gemini")).toContain("rate limited");
    expect(errorClassMessage("timeout", "claude")).toContain("timed out");
    expect(errorClassMessage("parse", "codex")).toContain("not valid JSON");
    expect(errorClassMessage("startup", "gemini")).toContain("failed to start");
    expect(errorClassMessage("unknown", "claude")).toContain("failed");
  });
});
