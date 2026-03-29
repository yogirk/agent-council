import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { buildContextBundle } from "../src/council";

const tmpDir = resolve(import.meta.dir, ".tmp-council-test");

describe("buildContextBundle security", () => {
  // Create a temp repo-like directory with a test file
  const repoRoot = resolve(tmpDir, "repo");
  const safeFile = "src/hello.ts";

  test("setup", () => {
    mkdirSync(resolve(repoRoot, "src"), { recursive: true });
    writeFileSync(resolve(repoRoot, safeFile), "console.log('hello');");
  });

  test("accepts safe relative paths", () => {
    const result = buildContextBundle([safeFile], repoRoot);
    expect(result).toContain("console.log");
    expect(result).not.toContain("rejected");
  });

  test("rejects absolute paths", () => {
    const result = buildContextBundle(["/etc/passwd"], repoRoot);
    expect(result).toContain("rejected: absolute paths not allowed");
  });

  test("rejects directory traversal with ..", () => {
    const result = buildContextBundle(["../../etc/passwd"], repoRoot);
    expect(result).toContain("rejected: directory traversal not allowed");
  });

  test("rejects hidden traversal in middle of path", () => {
    const result = buildContextBundle(["src/../../../etc/passwd"], repoRoot);
    expect(result).toContain("rejected: directory traversal not allowed");
  });

  test("rejects sensitive file extensions", () => {
    const exts = [".key", ".pem", ".env", ".secret", ".token"];
    for (const ext of exts) {
      const result = buildContextBundle([`config${ext}`], repoRoot);
      expect(result).toContain("rejected: sensitive file type");
    }
  });

  test("handles missing files gracefully", () => {
    const result = buildContextBundle(["nonexistent.ts"], repoRoot);
    expect(result).toContain("file not found");
  });

  test("handles empty file list", () => {
    const result = buildContextBundle([], repoRoot);
    expect(result).toBe("");
  });

  test("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
