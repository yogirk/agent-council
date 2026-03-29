import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";

const tmpHome = resolve(import.meta.dir, ".tmp-config-test");
const configDir = resolve(tmpHome, ".council");
const configPath = resolve(configDir, "config.json");

describe("config.json", () => {
  beforeEach(() => {
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("valid config is parseable JSON", () => {
    const config = {
      models: {
        claude: "claude-opus-4-6",
        codex: "gpt-5.4",
        gemini: "gemini-3.1-pro",
      },
      timeout_ms: 120000,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(parsed.models.claude).toBe("claude-opus-4-6");
    expect(parsed.timeout_ms).toBe(120000);
  });

  test("partial config has correct structure", () => {
    const config = { models: { claude: "claude-sonnet-4-6" } };
    writeFileSync(configPath, JSON.stringify(config));

    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(parsed.models.claude).toBe("claude-sonnet-4-6");
    expect(parsed.models.codex).toBeUndefined();
  });

  test("empty object is valid", () => {
    writeFileSync(configPath, "{}");
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(parsed).toEqual({});
  });

  test("malformed JSON doesn't crash", () => {
    writeFileSync(configPath, "not json{{{");
    expect(() => {
      JSON.parse(readFileSync(configPath, "utf-8"));
    }).toThrow();
  });
});
