import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { resolve, basename, join } from "path";
import { homedir } from "os";
import {
  type AgentAdapter,
  type AgentId,
  type AgentResult,
  type SessionMeta,
  detectAgents,
  allAdapters,
} from "./adapters";
import { stage1Prompt, stage2Prompt } from "./prompts";
import { generateViewer } from "./viewer";

// --- Types ---

interface CouncilConfig {
  models: Record<string, string>;
  timeout_ms: Record<string, number>;
  quorum_grace_ms: number;
}

// --- Config ---

const DEFAULT_TIMEOUTS: Record<string, number> = {
  claude: 120_000,
  codex: 120_000,
  gemini: 180_000,
};

const DEFAULT_CONFIG: CouncilConfig = {
  models: {
    claude: "claude-opus-4-6",
    codex: "gpt-5.4",
    gemini: "gemini-3.1-pro",
  },
  timeout_ms: { ...DEFAULT_TIMEOUTS },
  quorum_grace_ms: 30_000,
};

function councilHome(): string {
  const home = resolve(homedir(), ".council");
  try {
    mkdirSync(home, { recursive: true });
    return home;
  } catch {
    // Fallback to .council/ in project root (e.g. when sandboxed)
    const local = resolve(process.cwd(), ".council");
    mkdirSync(local, { recursive: true });
    return local;
  }
}

function loadConfig(): CouncilConfig {
  const configPath = resolve(councilHome(), "config.json");
  if (!existsSync(configPath)) return DEFAULT_CONFIG;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    // timeout_ms can be a number (applied to all) or per-agent object
    let timeouts = { ...DEFAULT_TIMEOUTS };
    if (parsed.timeout_ms) {
      if (typeof parsed.timeout_ms === "number") {
        timeouts = { claude: parsed.timeout_ms, codex: parsed.timeout_ms, gemini: parsed.timeout_ms };
      } else if (typeof parsed.timeout_ms === "object") {
        timeouts = { ...DEFAULT_TIMEOUTS, ...parsed.timeout_ms };
      }
    }

    return {
      models: { ...DEFAULT_CONFIG.models, ...(parsed.models || {}) },
      timeout_ms: timeouts,
      quorum_grace_ms: parsed.quorum_grace_ms || DEFAULT_CONFIG.quorum_grace_ms,
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

// --- Stage 1: Independent Opinions (with quorum + grace window) ---

async function dispatchWithQuorum(
  members: AgentAdapter[],
  prompt: string,
  repoRoot: string,
  timeouts: Record<string, number>,
  gracePeriodMs: number,
  stageName: string
): Promise<AgentResult[]> {
  const quorum = Math.max(2, members.length - 1); // need N-1 or at least 2

  console.error(`Dispatching ${stageName} to ${members.length} agents in parallel...`);
  for (const m of members) {
    console.error(`  - ${m.id} (timeout: ${(timeouts[m.id] || 120000) / 1000}s)`);
  }

  // Track results as they arrive
  const results: (AgentResult | null)[] = new Array(members.length).fill(null);
  let successCount = 0;
  let completedCount = 0;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<AgentResult[]>((resolveAll) => {
    let resolved = false;

    function tryResolve(reason: string) {
      if (resolved) return;
      resolved = true;
      if (graceTimer) clearTimeout(graceTimer);
      console.error(`  ${reason}`);

      // Fill in any still-pending agents as timeouts
      const final = results.map((r, i) => {
        if (r) return r;
        return {
          agent: members[i].id,
          status: "timeout" as const,
          structured: false,
          response: "",
          error: "Skipped (quorum reached, grace period expired)",
          duration_ms: 0,
          timestamp: new Date().toISOString(),
        };
      });
      resolveAll(final);
    }

    members.forEach((adapter, i) => {
      const agentTimeout = timeouts[adapter.id] || 120_000;
      dispatchAgent(adapter, prompt, repoRoot, agentTimeout).then((result) => {
        results[i] = result;
        completedCount++;
        if (result.status === "ok") {
          successCount++;
          console.error(`  ${adapter.id} responded (${(result.duration_ms / 1000).toFixed(1)}s)`);
          // Progressive output: show recommendation snippet
          if (result.recommendation) {
            const snippet = result.recommendation.slice(0, 120).replace(/\n/g, " ");
            console.error(`    \u2192 ${snippet}${result.recommendation.length > 120 ? "..." : ""}`);
          }
        } else {
          console.error(`  ${adapter.id} ${result.status}: ${result.error}`);
        }

        // All done
        if (completedCount === members.length) {
          tryResolve(`All ${members.length} agents responded.`);
          return;
        }

        // Quorum reached, start grace window for stragglers
        if (successCount >= quorum && !graceTimer && !resolved) {
          const remaining = members.length - completedCount;
          console.error(`  Quorum reached (${successCount}/${members.length}). Giving stragglers ${gracePeriodMs / 1000}s grace...`);
          graceTimer = setTimeout(() => {
            tryResolve(`Grace period expired. ${remaining} agent(s) still pending.`);
          }, gracePeriodMs);
        }
      });
    });
  });
}

async function runStage1(
  members: AgentAdapter[],
  question: string,
  context: string,
  repoRoot: string,
  timeouts: Record<string, number>,
  gracePeriodMs: number
): Promise<AgentResult[]> {
  const prompt = stage1Prompt(question, context);
  return dispatchWithQuorum(members, prompt, repoRoot, timeouts, gracePeriodMs, "Stage 1");
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
  timeouts: Record<string, number>,
  gracePeriodMs: number
): Promise<AgentResult[]> {
  const { anonymized } = anonymizeOpinions(opinions);
  const prompt = stage2Prompt(question, anonymized);
  return dispatchWithQuorum(members, prompt, repoRoot, timeouts, gracePeriodMs, "Stage 2");
}

// --- Storage ---

function createSessionDir(project: string): { sessionId: string; sessionDir: string } {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const sessionId = `council-${ts}`;
  const projectDir = resolve(councilHome(), project);
  const sessionDir = resolve(projectDir, sessionId);

  mkdirSync(resolve(sessionDir, "stage1"), { recursive: true });
  return { sessionId, sessionDir };
}

async function writeJson(dir: string, filename: string, data: any): Promise<void> {
  const tmpPath = resolve(dir, `.${filename}.tmp`);
  const finalPath = resolve(dir, filename);
  await Bun.write(tmpPath, JSON.stringify(data, null, 2));
  const { renameSync } = await import("fs");
  renameSync(tmpPath, finalPath);
}

// --- CLI: list and replay ---

function listSessions(project: string): void {
  const projectDir = resolve(councilHome(), project);
  if (!existsSync(projectDir)) {
    console.log("No council sessions found.");
    return;
  }

  const sessions = readdirSync(projectDir)
    .filter((d) => d.startsWith("council-"))
    .sort()
    .reverse();

  if (sessions.length === 0) {
    console.log("No council sessions found.");
    return;
  }

  console.log(`\nCouncil sessions for "${project}":\n`);
  for (const session of sessions) {
    const metaPath = resolve(projectDir, session, "meta.json");
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
  const sessionDir = resolve(councilHome(), project, sessionId);

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

// --- Revisit (Living Decisions) ---

async function revisitSession(
  project: string,
  parentSessionId: string,
  chairman: AgentId,
  contextOverride: string[],
  config: CouncilConfig
): Promise<void> {
  const parentDir = resolve(councilHome(), project, parentSessionId);
  if (!existsSync(parentDir)) {
    console.error(`Session not found: ${parentSessionId}`);
    console.error(`Looking in: ${parentDir}`);
    process.exit(1);
  }

  const parentMetaPath = resolve(parentDir, "meta.json");
  if (!existsSync(parentMetaPath)) {
    console.error(`No meta.json in session: ${parentSessionId}`);
    process.exit(1);
  }

  const parentMeta: SessionMeta = JSON.parse(readFileSync(parentMetaPath, "utf-8"));

  console.error(`\nRevisiting council decision: ${parentSessionId}`);
  console.error(`Original question: ${parentMeta.question.slice(0, 80)}...`);
  console.error(`Original date: ${parentMeta.created_at}`);

  // Use context override if provided, otherwise re-read original context files
  const contextFiles = contextOverride.length > 0 ? contextOverride : parentMeta.context_files;
  const repoRoot = detectRepoRoot();
  const context = buildContextBundle(contextFiles, repoRoot);

  // Detect available agents
  const available = await detectAgents();
  if (available.length < 2) {
    console.error("Error: Agent Council requires at least 2 CLI agents.");
    process.exit(1);
  }

  // Create new session linked to parent
  const { sessionId, sessionDir } = createSessionDir(project);
  console.error(`New session: ${sessionId}`);
  console.error(`Storage: ${sessionDir}`);

  // Run Stage 1 with original question + current context
  const opinions = await runStage1(
    available,
    parentMeta.question,
    context,
    repoRoot,
    config.timeout_ms,
    config.quorum_grace_ms
  );

  // Write opinion files
  for (const opinion of opinions) {
    await writeJson(
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
    console.error("Error: All agents failed. Council cannot reconvene.");
    process.exit(1);
  }

  // Write meta with parent linkage
  const meta: SessionMeta = {
    id: sessionId,
    question: parentMeta.question,
    project,
    chairman,
    members: available.map((a) => a.id),
    mode: parentMeta.mode,
    created_at: new Date().toISOString(),
    context_files: contextFiles,
    parent_id: parentSessionId,
    revisits: [],
  };
  await writeJson(sessionDir, "meta.json", meta);

  // Update parent's revisits array
  parentMeta.revisits = parentMeta.revisits || [];
  parentMeta.revisits.push(sessionId);
  await writeJson(parentDir, "meta.json", parentMeta);

  // Generate viewer (will pick up parent data for side-by-side)
  generateViewer(sessionDir, meta, opinions);

  // Output session dir
  console.log(sessionDir);

  console.error(`\nRevisit complete. Parent: ${parentSessionId} → Child: ${sessionId}`);
  console.error(`Open viewer to compare: ${resolve(sessionDir, "viewer.html")}`);
}

// --- Outcome Annotations ---

async function recordOutcome(
  project: string,
  sessionId: string,
  result: string
): Promise<void> {
  const sessionDir = resolve(councilHome(), project, sessionId);
  if (!existsSync(sessionDir)) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const metaPath = resolve(sessionDir, "meta.json");
  const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));

  meta.outcome = {
    result,
    recorded_at: new Date().toISOString(),
  };

  await writeJson(sessionDir, "meta.json", meta);

  // Regenerate viewer with outcome data
  const stage1Dir = resolve(sessionDir, "stage1");
  if (existsSync(stage1Dir)) {
    const opinions = readdirSync(stage1Dir)
      .filter((f) => f.startsWith("opinion_") && f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(resolve(stage1Dir, f), "utf-8")));
    generateViewer(sessionDir, meta, opinions);
  }

  console.log(`Outcome recorded for ${sessionId}: "${result}"`);
  console.log(`Viewer updated: ${resolve(sessionDir, "viewer.html")}`);
}

// --- CLI Arg Parsing ---

function parseArgs(): {
  command: "run" | "list" | "replay" | "revisit" | "outcome";
  chairman: AgentId;
  questionFile?: string;
  project: string;
  mode: "fast" | "thorough" | "quick";
  contextFiles: string[];
  sessionId?: string;
  outcomeResult?: string;
} {
  const args = process.argv.slice(2);

  // Subcommands
  if (args[0] === "list") {
    const project = getFlag(args, "--project") || detectProjectSlug();
    return { command: "list", chairman: detectChairman(), project, mode: "fast", contextFiles: [] };
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
      chairman: detectChairman(),
      project,
      mode: "fast",
      contextFiles: [],
      sessionId,
    };
  }
  if (args[0] === "revisit") {
    const sessionId = args[1];
    if (!sessionId) {
      console.error("Usage: council revisit <session-id> [--project <slug>] [--context file1,file2]");
      process.exit(1);
    }
    const project = getFlag(args, "--project") || detectProjectSlug();
    const contextArg = getFlag(args, "--context");
    const contextFiles = contextArg ? contextArg.split(",") : [];
    const chairman = validateChairman(getFlag(args, "--chairman") || detectChairman());
    return {
      command: "revisit",
      chairman,
      project: validateProjectSlug(project),
      mode: "fast",
      contextFiles,
      sessionId,
    };
  }
  if (args[0] === "outcome") {
    const sessionId = args[1];
    if (!sessionId) {
      console.error("Usage: council outcome <session-id> --result \"description\"");
      process.exit(1);
    }
    const result = getFlag(args, "--result");
    if (!result) {
      console.error("Usage: council outcome <session-id> --result \"description\"");
      process.exit(1);
    }
    const project = getFlag(args, "--project") || detectProjectSlug();
    return {
      command: "outcome",
      chairman: detectChairman(),
      project: validateProjectSlug(project),
      mode: "fast",
      contextFiles: [],
      sessionId,
      outcomeResult: result,
    };
  }

  // Default: run a council session
  const questionFile = getFlag(args, "--question-file");
  const chairman = validateChairman(getFlag(args, "--chairman") || detectChairman());
  const project = validateProjectSlug(getFlag(args, "--project") || detectProjectSlug());
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

// --- Path validation ---

const SENSITIVE_EXTENSIONS = [".key", ".pem", ".env", ".secret", ".token", ".p12", ".pfx"];
const VALID_AGENT_IDS = ["claude", "codex", "gemini"];

function detectChairman(): AgentId {
  // Detect which CLI is invoking us by walking the process tree
  try {
    const { execSync } = require("child_process");
    let pid = process.ppid;
    for (let i = 0; i < 5 && pid > 1; i++) {
      const info = execSync(`ps -o ppid=,comm= -p ${pid} 2>/dev/null`, { encoding: "utf-8" }).trim();
      const parts = info.split(/\s+/);
      const cmd = (parts[parts.length - 1] || "").replace(/.*\//, "");
      if (cmd === "codex") return "codex";
      if (cmd === "gemini") return "gemini";
      if (cmd === "claude") return "claude";
      pid = parseInt(parts[0], 10);
      if (isNaN(pid)) break;
    }
  } catch {}
  // Fallback to env vars
  if (process.env.CODEX_SESSION_ID || process.env.CODEX_AGENT_ID) return "codex";
  if (process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) return "gemini";
  return "claude";
}

function isPathSafe(file: string, repoRoot: string): { safe: boolean; reason?: string } {
  if (file.startsWith("/")) {
    return { safe: false, reason: "absolute paths not allowed" };
  }
  if (file.includes("..")) {
    return { safe: false, reason: "directory traversal not allowed" };
  }
  if (SENSITIVE_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))) {
    return { safe: false, reason: "sensitive file type" };
  }
  const fullPath = resolve(repoRoot, file);
  try {
    const { realpathSync } = require("fs");
    const realPath = realpathSync(fullPath);
    const realRoot = realpathSync(repoRoot);
    if (!realPath.startsWith(realRoot + "/") && realPath !== realRoot) {
      return { safe: false, reason: "path outside repository" };
    }
  } catch {
    // File doesn't exist yet, but path pattern is safe
  }
  return { safe: true };
}

function validateProjectSlug(project: string): string {
  if (project.includes("..") || project.includes("/") || project.includes("\\")) {
    console.error(`Error: Invalid project name "${project}". Must not contain .., /, or \\.`);
    process.exit(1);
  }
  return project;
}

function validateChairman(chairman: string): AgentId {
  if (!VALID_AGENT_IDS.includes(chairman)) {
    console.error(`Error: Invalid chairman "${chairman}". Must be one of: ${VALID_AGENT_IDS.join(", ")}`);
    process.exit(1);
  }
  return chairman as AgentId;
}

// --- Context bundling ---

export function buildContextBundle(files: string[], repoRoot: string): string {
  if (files.length === 0) return "";

  const MAX_BYTES = 50 * 1024; // 50KB cap
  let totalBytes = 0;
  const sections: string[] = [];

  for (const file of files) {
    const check = isPathSafe(file, repoRoot);
    if (!check.safe) {
      sections.push(`### ${file}\n(rejected: ${check.reason})`);
      continue;
    }

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
  const config = loadConfig();

  // Handle subcommands
  if (parsed.command === "list") {
    listSessions(parsed.project);
    return;
  }
  if (parsed.command === "replay") {
    replaySession(parsed.project, parsed.sessionId!);
    return;
  }
  if (parsed.command === "revisit") {
    await revisitSession(
      parsed.project,
      parsed.sessionId!,
      parsed.chairman,
      parsed.contextFiles,
      config
    );
    return;
  }
  if (parsed.command === "outcome") {
    await recordOutcome(parsed.project, parsed.sessionId!, parsed.outcomeResult!);
    return;
  }

  // Run a council session
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

  // ALL agents participate in Stage 1 (including the chairman).
  // The chairman also synthesizes in Stage 3 via the SKILL.md.
  const members = available;

  // We need at least 2 agents total for a meaningful council
  if (members.length < 2) {
    console.error("Error: Agent Council requires at least 2 agents for deliberation.");
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
    config.timeout_ms,
    config.quorum_grace_ms
  );

  // Write opinion files
  for (const opinion of opinions) {
    await writeJson(
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
    await writeJson(sessionDir, "meta.json", {
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
      config.timeout_ms,
      config.quorum_grace_ms
    );

    for (const review of reviews) {
      await writeJson(
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
  await writeJson(sessionDir, "meta.json", meta);

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

// Run main() unless this file was imported by a test runner
// Bun.main is the entry point; when tests import us, Bun.main is the test file
const _entryFile = Bun.main;
const _isTestImport = _entryFile.includes("bun-test") || _entryFile.includes("/tests/") || _entryFile.endsWith(".test.ts");
if (!_isTestImport) {
  main().catch((e) => {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
  });
}
