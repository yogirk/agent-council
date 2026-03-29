#!/usr/bin/env bun
/**
 * Evaluation runner for Agent Council.
 *
 * Runs benchmark questions through the council AND through a single strong agent,
 * then outputs a comparison for human scoring.
 *
 * Usage:
 *   bun run eval/run-eval.ts                    # Run all 10 benchmarks
 *   bun run eval/run-eval.ts --id db-choice     # Run one benchmark
 *   bun run eval/run-eval.ts --dry-run          # Show questions without running
 */

import { readFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { resolve, basename } from "path";

interface Benchmark {
  id: string;
  category: string;
  question: string;
  context_files: string[];
  expected_considerations: string[];
}

const BENCHMARKS: Benchmark[] = JSON.parse(
  readFileSync(resolve(import.meta.dir, "benchmarks.json"), "utf-8")
);

const EVAL_DIR = resolve(import.meta.dir, "results");
const COUNCIL_BIN = resolve(import.meta.dir, "..", "bin", "council");

// --- Arg parsing ---

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetId = getFlag(args, "--id");
const project = "eval-benchmark";

function getFlag(a: string[], flag: string): string | undefined {
  const idx = a.indexOf(flag);
  if (idx === -1 || idx + 1 >= a.length) return undefined;
  return a[idx + 1];
}

// --- Single agent baseline ---

async function runSingleAgent(question: string): Promise<{ response: string; duration_ms: number }> {
  const start = Date.now();
  const proc = Bun.spawn(
    ["claude", "-p", question, "--output-format", "json"],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);

  const duration_ms = Date.now() - start;

  if (exitCode !== 0) {
    return { response: "(single agent failed)", duration_ms };
  }

  try {
    const parsed = JSON.parse(stdout);
    return { response: parsed.result || "(empty)", duration_ms };
  } catch {
    return { response: stdout, duration_ms };
  }
}

// --- Council run ---

async function runCouncil(question: string): Promise<{ sessionDir: string; duration_ms: number }> {
  const start = Date.now();
  const questionFile = `/tmp/eval-q-${Date.now()}.txt`;
  writeFileSync(questionFile, question);

  const proc = Bun.spawn(
    [COUNCIL_BIN, "--question-file", questionFile, "--chairman", "claude", "--project", project],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);

  const duration_ms = Date.now() - start;
  try { require("fs").unlinkSync(questionFile); } catch {}

  return { sessionDir: stdout.trim(), duration_ms };
}

// --- Scoring helper ---

function checkConsiderations(response: string, expected: string[]): { found: string[]; missing: string[] } {
  const lower = response.toLowerCase();
  const found = expected.filter((c) => lower.includes(c.toLowerCase()));
  const missing = expected.filter((c) => !lower.includes(c.toLowerCase()));
  return { found, missing };
}

// --- Main ---

async function main() {
  mkdirSync(EVAL_DIR, { recursive: true });

  const benchmarks = targetId
    ? BENCHMARKS.filter((b) => b.id === targetId)
    : BENCHMARKS;

  if (benchmarks.length === 0) {
    console.error(`No benchmark found with id: ${targetId}`);
    console.error(`Available: ${BENCHMARKS.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n${benchmarks.length} benchmarks:\n`);
    for (const b of benchmarks) {
      console.log(`  [${b.id}] (${b.category})`);
      console.log(`  ${b.question.slice(0, 100)}...`);
      console.log(`  Expected: ${b.expected_considerations.join(", ")}\n`);
    }
    return;
  }

  console.log(`\nRunning ${benchmarks.length} benchmark(s)...\n`);

  const results: any[] = [];

  for (const benchmark of benchmarks) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${benchmark.id}] ${benchmark.category}`);
    console.log(`Q: ${benchmark.question.slice(0, 80)}...`);
    console.log(`${"=".repeat(60)}`);

    // Run single agent
    console.log("\n  Running single agent (Claude)...");
    const single = await runSingleAgent(benchmark.question);
    console.log(`  Single agent: ${single.duration_ms}ms`);

    // Run council
    console.log("  Running council...");
    const council = await runCouncil(benchmark.question);
    console.log(`  Council: ${council.duration_ms}ms`);

    // Check considerations
    const singleCheck = checkConsiderations(single.response, benchmark.expected_considerations);
    const councilOpinions = council.sessionDir
      ? readCouncilOpinions(council.sessionDir)
      : "";
    const councilCheck = checkConsiderations(councilOpinions, benchmark.expected_considerations);

    const result = {
      id: benchmark.id,
      category: benchmark.category,
      single_agent: {
        duration_ms: single.duration_ms,
        considerations_found: singleCheck.found.length,
        considerations_missing: singleCheck.missing,
        response_length: single.response.length,
      },
      council: {
        duration_ms: council.duration_ms,
        session_dir: council.sessionDir,
        considerations_found: councilCheck.found.length,
        considerations_missing: councilCheck.missing,
        response_length: councilOpinions.length,
      },
      considerations_total: benchmark.expected_considerations.length,
    };

    results.push(result);

    console.log(`\n  Single: ${singleCheck.found.length}/${benchmark.expected_considerations.length} considerations`);
    console.log(`  Council: ${councilCheck.found.length}/${benchmark.expected_considerations.length} considerations`);
    if (singleCheck.missing.length > 0) {
      console.log(`  Single missed: ${singleCheck.missing.join(", ")}`);
    }
    if (councilCheck.missing.length > 0) {
      console.log(`  Council missed: ${councilCheck.missing.join(", ")}`);
    }
  }

  // Write results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = resolve(EVAL_DIR, `eval-${timestamp}.json`);
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("EVALUATION SUMMARY");
  console.log(`${"=".repeat(60)}`);

  let singleTotal = 0;
  let councilTotal = 0;
  let totalConsiderations = 0;

  for (const r of results) {
    singleTotal += r.single_agent.considerations_found;
    councilTotal += r.council.considerations_found;
    totalConsiderations += r.considerations_total;
  }

  console.log(`\n  Benchmarks run: ${results.length}`);
  console.log(`  Single agent considerations: ${singleTotal}/${totalConsiderations} (${Math.round(singleTotal / totalConsiderations * 100)}%)`);
  console.log(`  Council considerations:      ${councilTotal}/${totalConsiderations} (${Math.round(councilTotal / totalConsiderations * 100)}%)`);
  console.log(`  Delta: ${councilTotal - singleTotal > 0 ? "+" : ""}${councilTotal - singleTotal}`);
  console.log(`\n  Results saved to: ${resultsPath}`);
  console.log(`\n  NOTE: This measures consideration coverage, not answer quality.`);
  console.log(`  Human scoring of response quality is recommended for a complete evaluation.\n`);
}

function readCouncilOpinions(sessionDir: string): string {
  try {
    const stage1Dir = resolve(sessionDir, "stage1");
    if (!existsSync(stage1Dir)) return "";

    const files = require("fs")
      .readdirSync(stage1Dir)
      .filter((f: string) => f.startsWith("opinion_"));

    let combined = "";
    for (const file of files) {
      const opinion = JSON.parse(readFileSync(resolve(stage1Dir, file), "utf-8"));
      combined += opinion.response + "\n";
    }
    return combined;
  } catch {
    return "";
  }
}

main().catch((e) => {
  console.error(`Eval failed: ${e.message}`);
  process.exit(1);
});
