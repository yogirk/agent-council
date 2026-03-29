import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { resolve, basename, join } from "path";
import {
  type AgentAdapter,
  type AgentId,
  type AgentResult,
  detectAgents,
  allAdapters,
} from "./adapters";
import { stage1Prompt, stage2Prompt } from "./prompts";
import { generateViewer } from "./viewer";

// --- Types ---

interface CouncilConfig {
  models: Record<string, string>;
  timeout_ms: number;
}

interface SessionMeta {
  id: string;
  question: string;
  project: string;
  chairman: AgentId;
  members: AgentId[];
  mode: "fast" | "thorough" | "quick";
  created_at: string;
  context_files: string[];
  parent_id: string | null;
  revisits: string[];
}

// --- Config ---

const DEFAULT_CONFIG: CouncilConfig = {
  models: {
    claude: "claude-opus-4-6",
    codex: "gpt-5.4",
    gemini: "gemini-3.1-pro",
  },
  timeout_ms: 120_000,
};

function loadConfig(): CouncilConfig {
  const configPath = resolve(
    process.env.HOME || "~",
    ".council",
    "config.json"
  );
  if (!existsSync(configPath)) return DEFAULT_CONFIG;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      models: { ...DEFAULT_CONFIG.models, ...(parsed.models || {}) },
      timeout_ms: parsed.timeout_ms || DEFAULT_CONFIG.timeout_ms,
    };
  } catch (e: any) {
    console.error(`Warning: Failed to parse ${configPath}: ${e.message}. Using defaults.`);
    return DEFAULT_CONFIG;
  }
}

// --- Subprocess dispatch ---

async function dispatchAgent(
  adapter: AgentAdapter,
  prompt: string,
  repoRoot: string,
  timeoutMs: number
): Promise<AgentResult> {
  const startTime = Date.now();
  const cmd = adapter.command(prompt, repoRoot);
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: repoRoot,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    // Force kill after 5s if still alive
    setTimeout(() => proc.kill("SIGKILL"), 5000);
  }, timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;

    if (timedOut) {
      return {
        agent: adapter.id,
        status: "timeout",
        structured: false,
        response: "",
        error: `Agent did not respond within ${timeoutMs / 1000} seconds`,
        raw_stderr: stderr,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };
    }

    return adapter.parseOutput(stdout, stderr, exitCode, durationMs);
  } catch (e: any) {
    clearTimeout(timer);
    return {
      agent: adapter.id,
      status: "error",
      structured: false,
      response: "",
      error: e.message,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

// --- Stage 1: Independent Opinions ---

async function runStage1(
  members: AgentAdapter[],
  question: string,
  context: string,
  repoRoot: string,
  timeoutMs: number
): Promise<AgentResult[]> {
  const prompt = stage1Prompt(question, context);

  console.error(`Dispatching Stage 1 to ${members.length} agents in parallel...`);
  for (const m of members) {
    console.error(`  - ${m.id}`);
  }

  const results = await Promise.allSettled(
    members.map((adapter) => dispatchAgent(adapter, prompt, repoRoot, timeoutMs))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: members[i].id,
      status: "error" as const,
      structured: false,
      response: "",
      error: r.reason?.message || "Unknown error",
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    };
  });
}

// --- Stage 2: Anonymized Peer Review ---

function anonymizeOpinions(
  opinions: AgentResult[]
): { anonymized: string; mapping: Record<string, AgentId> } {
  const labels = ["A", "B", "C", "D", "E"];
  const mapping: Record<string, AgentId> = {};
  const sections: string[] = [];

  opinions.forEach((op, i) => {
    const label = labels[i] || `${i + 1}`;
    mapping[label] = op.agent;
    sections.push(`## Response ${label}\n${op.response}`);
  });

  return { anonymized: sections.join("\n\n"), mapping };
}

async function runStage2(
  members: AgentAdapter[],
  question: string,
  opinions: AgentResult[],
  repoRoot: string,
  timeoutMs: number
): Promise<AgentResult[]> {
  const { anonymized } = anonymizeOpinions(opinions);
  const prompt = stage2Prompt(question, anonymized);

  console.error(`Dispatching Stage 2 peer review to ${members.length} agents...`);

  const results = await Promise.allSettled(
    members.map((adapter) => dispatchAgent(adapter, prompt, repoRoot, timeoutMs))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: members[i].id,
      status: "error" as const,
      structured: false,
      response: "",
      error: r.reason?.message || "Unknown error",
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    };
  });
}

// --- Storage ---

function createSessionDir(project: string): { sessionId: string; sessionDir: string } {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const sessionId = `council-${ts}`;
  const councilHome = resolve(process.env.HOME || "~", ".council", project);
  const sessionDir = resolve(councilHome, sessionId);

  mkdirSync(resolve(sessionDir, "stage1"), { recursive: true });
  return { sessionId, sessionDir };
}

function writeJson(dir: string, filename: string, data: any): void {
  const tmpPath = resolve(dir, `.${filename}.tmp`);
  const finalPath = resolve(dir, filename);
  Bun.write(tmpPath, JSON.stringify(data, null, 2));
  // Atomic rename to prevent partial writes
  const fs = require("fs");
  fs.renameSync(tmpPath, finalPath);
}

// --- CLI: list and replay ---

function listSessions(project: string): void {
  const councilHome = resolve(process.env.HOME || "~", ".council", project);
  if (!existsSync(councilHome)) {
    console.log("No council sessions found.");
    return;
  }

  const sessions = readdirSync(councilHome)
    .filter((d) => d.startsWith("council-"))
    .sort()
    .reverse();

  if (sessions.length === 0) {
    console.log("No council sessions found.");
    return;
  }

  console.log(`\nCouncil sessions for "${project}":\n`);
  for (const session of sessions) {
    const metaPath = resolve(councilHome, session, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      const question =
        meta.question.length > 70
          ? meta.question.slice(0, 70) + "..."
          : meta.question;
      const agents = meta.members.length + 1; // +1 for chairman
      console.log(`  ${meta.id}  ${meta.mode.padEnd(8)}  ${agents} agents  ${question}`);
    } catch {
      console.log(`  ${session}  (metadata unreadable)`);
    }
  }
  console.log("");
}

function replaySession(project: string, sessionId: string): void {
  const sessionDir = resolve(
    process.env.HOME || "~",
    ".council",
    project,
    sessionId
  );

  if (!existsSync(sessionDir)) {
    console.error(`Session not found: ${sessionId}`);
    console.error(`Looking in: ${sessionDir}`);
    process.exit(1);
  }

  const metaPath = resolve(sessionDir, "meta.json");
  if (!existsSync(metaPath)) {
    console.error(`No meta.json in session: ${sessionId}`);
    process.exit(1);
  }

  const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));

  console.log(`\n${"=".repeat(70)}`);
  console.log(`COUNCIL SESSION: ${meta.id}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Question: ${meta.question}`);
  console.log(`Mode: ${meta.mode} | Chairman: ${meta.chairman} | Members: ${meta.members.join(", ")}`);
  console.log(`Date: ${meta.created_at}`);
  console.log(`${"=".repeat(70)}\n`);

  // Stage 1 opinions
  const stage1Dir = resolve(sessionDir, "stage1");
  if (existsSync(stage1Dir)) {
    const opinionFiles = readdirSync(stage1Dir).filter((f) =>
      f.startsWith("opinion_")
    );
    for (const file of opinionFiles) {
      const opinion: AgentResult = JSON.parse(
        readFileSync(resolve(stage1Dir, file), "utf-8")
      );
      const agentName = opinion.agent.toUpperCase();
      console.log(`--- ${agentName} ${opinion.status === "ok" ? `(${opinion.confidence || "?"} confidence)` : `[${opinion.status}]`} ---`);
      if (opinion.status === "ok") {
        console.log(opinion.response);
      } else {
        console.log(`Error: ${opinion.error}`);
      }
      console.log("");
    }
  }

  // Synthesis
  const synthesisPath = resolve(sessionDir, "synthesis.json");
  if (existsSync(synthesisPath)) {
    const synthesis = JSON.parse(readFileSync(synthesisPath, "utf-8"));
    console.log(`--- CHAIRMAN SYNTHESIS (${meta.chairman}) ---`);
    console.log(
      synthesis.recommendation || synthesis.response || "(no synthesis)"
    );
    if (synthesis.confidence) {
      console.log(`\nConfidence: ${synthesis.confidence}`);
    }
  }

  console.log(`\n${"=".repeat(70)}\n`);
}

// --- CLI Arg Parsing ---

function parseArgs(): {
  command: "run" | "list" | "replay" | "view";
  chairman: AgentId;
  questionFile?: string;
  project: string;
  mode: "fast" | "thorough" | "quick";
  contextFiles: string[];
  sessionId?: string;
} {
  const args = process.argv.slice(2);

  // Subcommands
  if (args[0] === "list") {
    const project = getFlag(args, "--project") || detectProjectSlug();
    return { command: "list", chairman: "claude", project, mode: "fast", contextFiles: [] };
  }
  if (args[0] === "replay") {
    const sessionId = args[1];
    if (!sessionId) {
      console.error("Usage: council replay <session-id>");
      process.exit(1);
    }
    const project = getFlag(args, "--project") || detectProjectSlug();
    return {
      command: "replay",
      chairman: "claude",
      project,
      mode: "fast",
      contextFiles: [],
      sessionId,
    };
  }
  if (args[0] === "view") {
    const project = getFlag(args, "--project") || detectProjectSlug();
    return { command: "view", chairman: "claude", project, mode: "fast", contextFiles: [] };
  }

  // Default: run a council session
  const questionFile = getFlag(args, "--question-file");
  const chairman = (getFlag(args, "--chairman") || "claude") as AgentId;
  const project = getFlag(args, "--project") || detectProjectSlug();
  const withReview = args.includes("--with-review");
  const quick = args.includes("--quick");
  const contextArg = getFlag(args, "--context");
  const contextFiles = contextArg ? contextArg.split(",") : [];

  const mode = quick ? "quick" : withReview ? "thorough" : "fast";

  if (!questionFile) {
    console.error("Usage: council --question-file <path> [--chairman <agent>] [--project <slug>] [--with-review] [--quick] [--context file1,file2]");
    process.exit(1);
  }

  return { command: "run", chairman, questionFile, project, mode, contextFiles };
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function detectProjectSlug(): string {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
    const root = new TextDecoder().decode(proc.stdout).trim();
    if (root) return basename(root);
  } catch {}
  return basename(process.cwd());
}

// --- Context bundling ---

function buildContextBundle(files: string[], repoRoot: string): string {
  if (files.length === 0) return "";

  const MAX_BYTES = 50 * 1024; // 50KB cap
  let totalBytes = 0;
  const sections: string[] = [];

  for (const file of files) {
    const fullPath = resolve(repoRoot, file);
    if (!existsSync(fullPath)) {
      sections.push(`### ${file}\n(file not found)`);
      continue;
    }
    const content = readFileSync(fullPath, "utf-8");
    const bytes = Buffer.byteLength(content);

    if (totalBytes + bytes > MAX_BYTES) {
      const remaining = MAX_BYTES - totalBytes;
      sections.push(
        `### ${file}\n${content.slice(0, remaining)}\n... (truncated, ${bytes} bytes total)`
      );
      break;
    }

    sections.push(`### ${file}\n${content}`);
    totalBytes += bytes;
  }

  return sections.join("\n\n");
}

// --- Main ---

async function main(): Promise<void> {
  const parsed = parseArgs();

  // Handle subcommands
  if (parsed.command === "list") {
    listSessions(parsed.project);
    return;
  }
  if (parsed.command === "replay") {
    replaySession(parsed.project, parsed.sessionId!);
    return;
  }

  // Run a council session
  const config = loadConfig();
  const repoRoot = detectRepoRoot();
  const question = readFileSync(parsed.questionFile!, "utf-8").trim();

  // Detect available agents
  const available = await detectAgents();
  const availableIds = available.map((a) => a.id);

  if (available.length < 2) {
    console.error(
      `Error: Agent Council requires at least 2 CLI agents. Found: ${availableIds.join(", ") || "none"}.`
    );
    console.error("Install: claude (Claude Code), codex (OpenAI Codex), gemini (Gemini CLI)");
    process.exit(1);
  }

  console.error(`Detected agents: ${availableIds.join(", ")}`);
  console.error(`Chairman: ${parsed.chairman}`);

  // Exclude chairman from dispatch members
  const members = available.filter((a) => a.id !== parsed.chairman);

  if (members.length === 0) {
    console.error("Error: No non-chairman agents available to dispatch.");
    process.exit(1);
  }

  // Build context
  const context = buildContextBundle(parsed.contextFiles, repoRoot);

  // Create session directory
  const { sessionId, sessionDir } = createSessionDir(parsed.project);
  console.error(`Session: ${sessionId}`);
  console.error(`Storage: ${sessionDir}`);

  // Stage 1: Independent opinions
  const opinions = await runStage1(
    members,
    question,
    context,
    repoRoot,
    config.timeout_ms
  );

  // Write opinion files
  for (const opinion of opinions) {
    writeJson(
      resolve(sessionDir, "stage1"),
      `opinion_${opinion.agent}.json`,
      opinion
    );
  }

  const successfulOpinions = opinions.filter((o) => o.status === "ok");
  console.error(
    `Stage 1 complete: ${successfulOpinions.length}/${opinions.length} successful opinions`
  );

  if (successfulOpinions.length === 0) {
    console.error("Error: All agents failed. Council cannot convene.");
    writeJson(sessionDir, "meta.json", {
      id: sessionId,
      question,
      project: parsed.project,
      chairman: parsed.chairman,
      members: members.map((m) => m.id),
      mode: parsed.mode,
      created_at: new Date().toISOString(),
      context_files: parsed.contextFiles,
      parent_id: null,
      revisits: [],
      error: "All agents failed",
    });
    process.exit(1);
  }

  // Stage 2: Peer review (if thorough mode)
  if (parsed.mode === "thorough") {
    mkdirSync(resolve(sessionDir, "stage2"), { recursive: true });
    console.error("\nRunning Stage 2: Anonymized peer review...");

    const reviews = await runStage2(
      members,
      question,
      successfulOpinions,
      repoRoot,
      config.timeout_ms
    );

    for (const review of reviews) {
      writeJson(
        resolve(sessionDir, "stage2"),
        `review_${review.agent}.json`,
        review
      );
    }

    const successfulReviews = reviews.filter((r) => r.status === "ok");
    console.error(
      `Stage 2 complete: ${successfulReviews.length}/${reviews.length} reviews`
    );
  }

  // Write meta.json
  const meta: SessionMeta = {
    id: sessionId,
    question,
    project: parsed.project,
    chairman: parsed.chairman,
    members: members.map((m) => m.id),
    mode: parsed.mode,
    created_at: new Date().toISOString(),
    context_files: parsed.contextFiles,
    parent_id: null,
    revisits: [],
  };
  writeJson(sessionDir, "meta.json", meta);

  // Generate viewer
  generateViewer(sessionDir, meta, opinions);

  // Output session dir path to stdout (for SKILL.md to capture)
  console.log(sessionDir);
}

function detectRepoRoot(): string {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
    const root = new TextDecoder().decode(proc.stdout).trim();
    if (root) return root;
  } catch {}
  return process.cwd();
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
