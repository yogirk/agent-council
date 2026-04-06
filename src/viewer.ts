import { resolve, dirname } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import type { AgentResult, SessionMeta } from "./adapters";

// --- Escaping ---

function escapeJsonForScript(data: any): string {
  return JSON.stringify(data)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Data loading ---

interface SynthesisData {
  chairman: string;
  consensus: string;
  divergence: string;
  recommendation: string;
  confidence: string;
  timestamp: string;
}

function loadSynthesis(sessionDir: string): SynthesisData | null {
  const path = resolve(sessionDir, "synthesis.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function loadReviews(sessionDir: string): AgentResult[] {
  const dir = resolve(sessionDir, "stage2");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("review_") && f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));
  } catch {
    return [];
  }
}

// --- Nudge loading ---

interface NudgeData {
  agent: string;
  status: string;
  recommendation?: string;
  confidence?: string;
  what_changed?: string;
  response: string;
  duration_ms: number;
  nudge_meta: {
    correction: string;
    original_recommendation?: string;
    original_confidence?: string;
    timestamp: string;
  };
}

function loadNudges(sessionDir: string): NudgeData[] {
  const dir = resolve(sessionDir, "stage4");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("nudge_") && f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")))
      .sort((a, b) => (a.nudge_meta?.timestamp || "").localeCompare(b.nudge_meta?.timestamp || ""));
  } catch {
    return [];
  }
}

// --- Parent session loading (for revisits) ---

interface ParentSessionData {
  meta: SessionMeta;
  opinions: Array<{
    agent: string;
    status: string;
    recommendation?: string;
    confidence?: string;
    response: string;
  }>;
  synthesis: SynthesisData | null;
}

function loadParentSession(sessionDir: string, parentId: string): ParentSessionData | null {
  const projectDir = dirname(sessionDir);
  const parentDir = resolve(projectDir, parentId);
  if (!existsSync(parentDir)) return null;
  try {
    const metaPath = resolve(parentDir, "meta.json");
    if (!existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const stage1Dir = resolve(parentDir, "stage1");
    const opinions = existsSync(stage1Dir)
      ? readdirSync(stage1Dir)
          .filter((f) => f.startsWith("opinion_") && f.endsWith(".json"))
          .map((f) => {
            const op = JSON.parse(readFileSync(resolve(stage1Dir, f), "utf-8"));
            return { agent: op.agent, status: op.status, recommendation: op.recommendation, confidence: op.confidence, response: op.response };
          })
      : [];
    const synthesis = loadSynthesis(parentDir);
    return { meta, opinions, synthesis };
  } catch {
    return null;
  }
}

// --- Generator ---

export function generateViewer(
  sessionDir: string,
  meta: SessionMeta,
  opinions: AgentResult[]
): void {
  const synthesis = loadSynthesis(sessionDir);
  const reviews = loadReviews(sessionDir);
  const nudges = loadNudges(sessionDir);
  const totalDuration = opinions.reduce((sum, o) => Math.max(sum, o.duration_ms), 0);
  const successCount = opinions.filter((o) => o.status === "ok").length;
  const parentSession = meta.parent_id ? loadParentSession(sessionDir, meta.parent_id) : null;

  const viewerData = {
    meta,
    opinions: opinions.map((o) => ({
      agent: o.agent,
      status: o.status,
      structured: o.structured,
      recommendation: o.recommendation,
      reasoning: o.reasoning,
      assumptions: o.assumptions,
      belief_update_trigger: o.belief_update_trigger,
      tradeoffs: o.tradeoffs,
      confidence: o.confidence,
      dissent_points: o.dissent_points,
      response: o.response,
      error: o.error,
      duration_ms: o.duration_ms,
    })),
    synthesis,
    reviews: reviews.map((r) => ({ agent: r.agent, status: r.status, response: r.response, duration_ms: r.duration_ms })),
    nudges: nudges.map(n => ({
      agent: n.agent,
      correction: n.nudge_meta.correction,
      original_recommendation: n.nudge_meta.original_recommendation,
      recommendation: n.recommendation,
      what_changed: n.what_changed,
      confidence: n.confidence,
      timestamp: n.nudge_meta.timestamp,
    })),
    parentSession,
    totalDuration,
    successCount,
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Council: ${escapeHtml(meta.question.slice(0, 60))}</title>
<style>
/* ════════════════════════════════════════
   RESET & FOUNDATION
   ════════════════════════════════════════ */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  /* Tonal surface palette */
  --surface:             #f8f9fa;
  --surface-low:         #f1f4f6;
  --surface-container:   #eaeff1;
  --surface-high:        #e3e9ec;
  --surface-highest:     #dbe4e7;
  --surface-lowest:      #ffffff;

  /* Text hierarchy */
  --on-surface:          #2b3437;
  --on-surface-2:        #586064;
  --on-surface-3:        #737c7f;
  --on-surface-4:        #abb3b7;

  /* Semantic */
  --primary:             #4c56af;
  --primary-dim:         #4049a2;
  --primary-container:   #e0e0ff;
  --tertiary:            #1c6d25;
  --tertiary-container:  #d4f5d0;
  --error:               #9e3f4e;
  --error-container:     #fce8ec;
  --diverge:             #f5ebe0;

  /* Agent palette */
  --claude:              #b45309;
  --claude-bg:           #fef7ed;
  --codex:               #0f766e;
  --codex-bg:            #ecfdf8;
  --gemini:              #6d28d9;
  --gemini-bg:           #f3efff;

  /* Ghost border */
  --ghost:               rgba(171, 179, 183, 0.15);

  /* Typography */
  --font-display:        Georgia, 'Times New Roman', serif;
  --font-body:           Georgia, 'Times New Roman', serif;
  --font-label:          -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
  --font-mono:           'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;

  --measure:             68ch;
  --radius:              0.5rem;
  --radius-sm:           0.25rem;
}

[data-theme="dark"] {
  --surface:             #161618;
  --surface-low:         #1c1c1f;
  --surface-container:   #222225;
  --surface-high:        #2a2a2e;
  --surface-highest:     #333338;
  --surface-lowest:      #1e1e21;

  --on-surface:          #e0e0db;
  --on-surface-2:        #a8a8a3;
  --on-surface-3:        #707068;
  --on-surface-4:        #4a4a45;

  --primary:             #929bfa;
  --primary-dim:         #7b84e8;
  --primary-container:   #2c2c4a;
  --tertiary:            #6ee06a;
  --tertiary-container:  #1a3a1c;
  --error:               #ff8b9a;
  --error-container:     #3a1a20;
  --diverge:             #2a2420;

  --claude:              #fbbf24;
  --claude-bg:           #292218;
  --codex:               #2dd4bf;
  --codex-bg:            #182926;
  --gemini:              #a78bfa;
  --gemini-bg:           #221e2e;

  --ghost:               rgba(255, 255, 255, 0.06);
}

/* ════════════════════════════════════════
   BASE
   ════════════════════════════════════════ */
html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-label);
  background: var(--surface);
  color: var(--on-surface);
  line-height: 1.6;
  transition: background 0.3s, color 0.3s;
}

/* ════════════════════════════════════════
   LAYOUT
   ════════════════════════════════════════ */
.page {
  max-width: 1060px;
  margin: 0 auto;
  padding: 2rem 2rem 5rem;
}

@media (max-width: 768px) {
  .page { padding: 1.25rem 1rem 3rem; }
}

/* ════════════════════════════════════════
   TOP BAR — glassmorphic
   ════════════════════════════════════════ */
.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 2rem;
  margin: -2rem -2rem 2rem;
  background: color-mix(in srgb, var(--surface) 75%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--ghost);
}

@media (max-width: 768px) {
  .topbar { margin: -1.25rem -1rem 1.5rem; padding: 0.75rem 1rem; }
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.council-mark {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: -0.01em;
}

.meta-pills {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.pill {
  font-family: var(--font-label);
  font-size: 0.6rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--on-surface-3);
  background: var(--surface-high);
  padding: 0.2rem 0.5rem;
  border-radius: 9999px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--on-surface-3);
  font-size: 1rem;
  padding: 0.25rem;
  transition: color 0.2s;
}
.theme-toggle:hover { color: var(--on-surface); }

/* ════════════════════════════════════════
   QUESTION — collapsible ribbon
   ════════════════════════════════════════ */
.question {
  margin-bottom: 2.5rem;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 0.75rem;
  cursor: pointer;
  user-select: none;
  border-radius: var(--radius);
  background: var(--surface-low);
  transition: background 0.2s;
}
.question-header:hover { background: var(--surface-container); }

.question-chevron {
  font-size: 0.7rem;
  color: var(--on-surface-3);
  transition: transform 0.25s ease;
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
}

.question-header[aria-expanded="true"] .question-chevron {
  transform: rotate(90deg);
}

.question-tag {
  font-family: var(--font-label);
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--on-surface-3);
  white-space: nowrap;
}

.question-summary {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.question-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s ease, opacity 0.3s ease;
  opacity: 0;
}
.question-body.open {
  opacity: 1;
  max-height: 2000px;
  transition: max-height 0.6s ease, opacity 0.3s ease 0.1s;
}

.question-full {
  font-family: var(--font-body);
  font-size: 0.95rem;
  line-height: 1.8;
  color: var(--on-surface-2);
  max-width: var(--measure);
  padding: 1rem 0.75rem 0.5rem 2.4rem;
}

/* ════════════════════════════════════════
   SECTION HEADINGS
   ════════════════════════════════════════ */
.section-label {
  font-family: var(--font-label);
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--on-surface-3);
  margin-bottom: 1rem;
}

/* ════════════════════════════════════════
   VERDICT
   ════════════════════════════════════════ */
.verdict {
  margin-bottom: 3rem;
}

.verdict-main {
  padding: 2rem;
  background: var(--surface-lowest);
  border-radius: var(--radius);
  border: 1px solid var(--ghost);
}

.verdict-rec {
  font-family: var(--font-display);
  font-size: 1.2rem;
  line-height: 1.75;
  color: var(--on-surface);
  margin-bottom: 1.5rem;
  border-left: 3px solid var(--primary);
  padding-left: 1rem;
}

.verdict-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 480px) {
  .verdict-grid { grid-template-columns: 1fr; }
}

.verdict-card {
  padding: 1rem;
  border-radius: var(--radius-sm);
}

.verdict-card--consensus {
  background: var(--tertiary-container);
}

.verdict-card--divergence {
  background: var(--diverge);
}

.verdict-card-label {
  font-family: var(--font-label);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tertiary);
  margin-bottom: 0.4rem;
}

.verdict-card--divergence .verdict-card-label {
  color: var(--error);
}

.verdict-card-text {
  font-family: var(--font-body);
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--on-surface-2);
}

/* Meta strip */
.meta-strip {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}

.meta-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--surface-low);
  border-radius: var(--radius);
  padding: 0.5rem 0.85rem;
}

.meta-chip-label {
  font-family: var(--font-label);
  font-size: 0.5rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--on-surface-3);
}

.meta-chip-value {
  font-family: var(--font-label);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--on-surface);
}

.meta-chip-value--accent { color: var(--tertiary); }

.meta-chip-detail {
  font-family: var(--font-label);
  font-size: 0.6rem;
  color: var(--on-surface-3);
}

/* ════════════════════════════════════════
   AGENT OPINIONS — tabbed
   ════════════════════════════════════════ */
.opinions {
  margin-bottom: 3rem;
}

.opinions-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--ghost);
  margin-bottom: 0;
}

.opinion-tab {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.7rem 1.25rem;
  cursor: pointer;
  border: none;
  background: none;
  font-family: var(--font-label);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--on-surface-3);
  position: relative;
  transition: color 0.2s, background 0.2s;
  border-radius: var(--radius) var(--radius) 0 0;
}

.opinion-tab:hover {
  color: var(--on-surface-2);
  background: var(--surface-low);
}

.opinion-tab[aria-selected="true"] {
  color: var(--on-surface);
  background: var(--surface-lowest);
}

.opinion-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--tab-color, var(--primary));
}

.opinion-tab-meta {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--on-surface-4);
  font-weight: 400;
}

.agent-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.opinion-panel {
  display: none;
  background: var(--surface-lowest);
  border: 1px solid var(--ghost);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  overflow: hidden;
}

.opinion-panel.active {
  display: block;
}

.agent-card-body {
  padding: 1.5rem 2rem;
}

@media (max-width: 768px) {
  .agent-card-body { padding: 1rem; }
  .opinion-tab { padding: 0.6rem 0.75rem; font-size: 0.7rem; }
}

/* Sub-sections within agent card */
.agent-sub {
  margin-bottom: 1rem;
}

.agent-sub:last-child { margin-bottom: 0; }

.agent-sub-label {
  font-family: var(--font-label);
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--on-surface-3);
  margin-bottom: 0.35rem;
}

.agent-sub-text {
  font-family: var(--font-body);
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--on-surface-2);
}

.reasoning-bullet {
  margin-bottom: 0.5rem;
  padding-left: 0.85rem;
  position: relative;
  font-family: var(--font-body);
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--on-surface-2);
}

.reasoning-bullet::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--on-surface-4);
}

.assumption-chip {
  display: inline-block;
  font-family: var(--font-label);
  font-size: 0.7rem;
  color: var(--on-surface-2);
  background: var(--surface-container);
  padding: 0.25rem 0.55rem;
  border-radius: 9999px;
  margin: 0.15rem 0.2rem 0.15rem 0;
  font-style: italic;
}

.confidence-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-label);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
}

.confidence-high {
  background: var(--tertiary-container);
  color: var(--tertiary);
}

.confidence-medium {
  background: #fef3c7;
  color: #92400e;
}

[data-theme="dark"] .confidence-medium {
  background: #3a3018;
  color: #fbbf24;
}

.confidence-low {
  background: var(--error-container);
  color: var(--error);
}

/* Dissent block */
.dissent-block {
  margin-top: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  border-left: 3px solid;
}

.dissent-label {
  font-family: var(--font-label);
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.25rem;
}

.dissent-text {
  font-family: var(--font-body);
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--on-surface-2);
}

/* Belief trigger */
.belief-trigger {
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-style: italic;
  color: var(--on-surface-3);
  padding: 0.5rem 0.65rem;
  border-left: 2px solid var(--on-surface-4);
  background: var(--surface-low);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* Expandable transcript */
.transcript-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-label);
  font-size: 0.6rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--on-surface-3);
  cursor: pointer;
  padding: 0.3rem 0;
  border: none;
  background: none;
  transition: color 0.2s;
}
.transcript-toggle:hover { color: var(--on-surface); }

.transcript-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s ease;
}
.transcript-body.open {
  max-height: 20000px;
  transition: max-height 0.8s ease;
}

.transcript-text {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.65;
  color: var(--on-surface-3);
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0.75rem;
  background: var(--surface-container);
  border-radius: var(--radius-sm);
  margin-top: 0.4rem;
  max-height: 350px;
  overflow-y: auto;
}

.transcript-text::-webkit-scrollbar { width: 4px; }
.transcript-text::-webkit-scrollbar-thumb { background: var(--on-surface-4); border-radius: 2px; }

/* ════════════════════════════════════════
   PEER REVIEW — score matrix
   ════════════════════════════════════════ */
.reviews {
  margin-bottom: 3rem;
}

/* Matrix grid */
.review-matrix {
  display: grid;
  gap: 0;
  background: var(--surface-lowest);
  border-radius: var(--radius);
  border: 1px solid var(--ghost);
  overflow: hidden;
}

/* Header row + column labels */
.rm-corner {
  background: var(--surface-high);
  padding: 0.6rem 0.75rem;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.rm-col-head {
  background: var(--surface-high);
  padding: 0.6rem 0.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.rm-col-label {
  font-family: var(--font-label);
  font-size: 0.65rem;
  font-weight: 700;
}

.rm-col-sub {
  font-family: var(--font-label);
  font-size: 0.5rem;
  color: var(--on-surface-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rm-row-head {
  background: var(--surface-low);
  padding: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border-top: 1px solid var(--ghost);
}

.rm-row-label {
  font-family: var(--font-label);
  font-size: 0.65rem;
  font-weight: 600;
}

.rm-row-sub {
  font-family: var(--font-label);
  font-size: 0.5rem;
  color: var(--on-surface-3);
  margin-left: auto;
}

/* Score cell */
.rm-cell {
  padding: 0.6rem 0.5rem;
  text-align: center;
  border-top: 1px solid var(--ghost);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.rm-cell:hover {
  background: var(--surface-low);
}

.rm-scores {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}

.rm-score-pip {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-label);
  font-size: 0.65rem;
  font-weight: 700;
  color: #fff;
}

.rm-score-5 { background: var(--tertiary); }
.rm-score-4 { background: #22863a; }
.rm-score-3 { background: #b08800; }
[data-theme="dark"] .rm-score-3 { background: #d4a017; }
.rm-score-2 { background: #d4691a; }
.rm-score-1 { background: var(--error); }

.rm-score-dim {
  font-family: var(--font-label);
  font-size: 0.45rem;
  color: var(--on-surface-4);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Tooltip on hover */
.rm-note {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  padding: 0.65rem 0.75rem;
  background: var(--on-surface);
  color: var(--surface);
  font-family: var(--font-body);
  font-size: 0.75rem;
  line-height: 1.55;
  border-radius: var(--radius-sm);
  z-index: 20;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}

.rm-note::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: var(--on-surface);
}

.rm-cell:hover .rm-note {
  display: block;
}

@media (max-width: 768px) {
  .rm-note {
    width: 200px;
    font-size: 0.7rem;
  }
}

/* Rankings row */
.review-rankings {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.ranking-card {
  flex: 1;
  min-width: 200px;
  background: var(--surface-low);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
}

.ranking-reviewer {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.ranking-reviewer-label {
  font-family: var(--font-label);
  font-size: 0.6rem;
  font-weight: 600;
}

.ranking-list {
  list-style: none;
  padding: 0;
}

.ranking-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0;
  font-family: var(--font-label);
  font-size: 0.7rem;
  color: var(--on-surface-2);
}

.ranking-pos {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  flex-shrink: 0;
}

.ranking-pos-1 { background: var(--tertiary-container); color: var(--tertiary); }
.ranking-pos-2 { background: var(--surface-high); color: var(--on-surface-2); }
.ranking-pos-3 { background: var(--surface-high); color: var(--on-surface-3); }

/* ════════════════════════════════════════
   NUDGES — evolutionary timeline
   ════════════════════════════════════════ */
.nudges {
  margin-bottom: 3rem;
}

.timeline-item {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.timeline-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.timeline-dot {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #fff;
  flex-shrink: 0;
}

.timeline-line {
  width: 1px;
  flex: 1;
  background: var(--on-surface-4);
  margin: 0.4rem 0;
}

.timeline-content {
  padding-top: 0.25rem;
}

.timeline-label {
  font-family: var(--font-label);
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--on-surface);
  margin-bottom: 0.15rem;
}

.timeline-time {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--on-surface-3);
  margin-bottom: 0.5rem;
}

.timeline-card {
  background: var(--surface-lowest);
  border: 1px solid var(--ghost);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  max-width: 40rem;
}

.timeline-card p {
  font-family: var(--font-body);
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--on-surface-2);
}

.timeline-shift {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  font-family: var(--font-label);
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tertiary);
}

/* ════════════════════════════════════════
   OUTCOME
   ════════════════════════════════════════ */
.outcome {
  margin-bottom: 2rem;
}

.outcome-body {
  padding: 1rem 1.25rem;
  background: var(--surface-low);
  border-radius: var(--radius);
}

.outcome-text {
  font-family: var(--font-body);
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--on-surface);
}

.outcome-ts {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--on-surface-3);
  margin-top: 0.4rem;
}

/* ════════════════════════════════════════
   REVIEWS — flat format fallback
   ════════════════════════════════════════ */
.review-flat {
  margin-bottom: 1rem;
}

.review-flat-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.review-flat-name {
  font-family: var(--font-label);
  font-size: 0.75rem;
  font-weight: 600;
}

.review-flat-meta {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--on-surface-3);
}

/* ════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════ */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); border: 0;
}

/* Smooth transitions */
.agent-card, .meta-card, .verdict-main, .review-panel,
.timeline-card, .outcome-body, .transcript-text {
  transition: background 0.3s ease, border-color 0.3s ease;
}
</style>
</head>
<body>

<div class="page" id="app"></div>

<script>
var D = ${escapeJsonForScript(viewerData)};

var AGENTS = {
  claude:  { label: 'Claude',  color: 'var(--claude)',  bg: 'var(--claude-bg)' },
  codex:   { label: 'Codex',   color: 'var(--codex)',   bg: 'var(--codex-bg)' },
  gemini:  { label: 'Gemini',  color: 'var(--gemini)',  bg: 'var(--gemini-bg)' }
};

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function el(tag, attrs) {
  var e = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      var v = attrs[k];
      if (k === 'style' && typeof v === 'object') {
        for (var sk in v) { if (v.hasOwnProperty(sk)) e.style[sk] = v[sk]; }
      } else if (k.startsWith('on') && typeof v === 'function') {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'className') {
        e.className = v;
      } else {
        e.setAttribute(k, v);
      }
    }
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

function frag() {
  var f = document.createDocumentFragment();
  for (var i = 0; i < arguments.length; i++) {
    var c = arguments[i];
    if (typeof c === 'string') f.appendChild(document.createTextNode(c));
    else if (c) f.appendChild(c);
  }
  return f;
}

function formatDuration(ms) {
  if (!ms) return '';
  return (ms / 1000).toFixed(1) + 's';
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch(e) { return ts; }
}

function summarizeQuestion(q) {
  var first = (q.match(/^[^.!?]+[.!?]/) || [q])[0].trim();
  return first.length > 72 ? first.substring(0, 69) + '\\u2026' : first;
}

function confLevel(conf) {
  if (!conf) return 'medium';
  var c = typeof conf === 'string' ? conf.toLowerCase() : '';
  if (c.includes('high')) return 'high';
  if (c.includes('low')) return 'low';
  return 'medium';
}

function confLabel(conf) {
  var l = confLevel(conf);
  return l.charAt(0).toUpperCase() + l.slice(1);
}

function makeToggle(header, body) {
  header.addEventListener('click', function() {
    var expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    body.classList.toggle('open');
  });
  header.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
  });
}

function stripMd(text) {
  if (!text) return '';
  return text.replace(/\\*\\*/g, '').replace(/\\*/g, '').replace(/^- /gm, '');
}

// ════════════════════════════════════════
// THEME
// ════════════════════════════════════════
function initTheme() {
  try {
    var stored = localStorage.getItem('council-theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', 'dark');
  } catch(e) {}
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('council-theme', next); } catch(e) {}
}

// ════════════════════════════════════════
// RENDERERS
// ════════════════════════════════════════

function renderTopbar(meta) {
  var left = el('div', { className: 'topbar-left' },
    el('span', { className: 'council-mark' }, 'Agent Council')
  );
  var pills = el('div', { className: 'meta-pills' });
  if (meta.project) pills.appendChild(el('span', { className: 'pill' }, meta.project));
  if (meta.mode) pills.appendChild(el('span', { className: 'pill' }, meta.mode));
  pills.appendChild(el('span', { className: 'pill' }, meta.id));
  left.appendChild(pills);

  var btn = el('button', { className: 'theme-toggle', 'aria-label': 'Toggle theme', onClick: toggleTheme });
  var updateIcon = function() {
    btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '\\u2600' : '\\u263e';
  };
  updateIcon();
  new MutationObserver(updateIcon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var right = el('div', { className: 'topbar-right' }, btn);
  return el('div', { className: 'topbar' }, left, right);
}

function renderQuestion(question) {
  var section = el('div', { className: 'question' });

  var header = el('div', {
    className: 'question-header', role: 'button',
    'aria-expanded': 'false', tabindex: '0'
  },
    el('span', { className: 'question-chevron' }, '\\u25b8'),
    el('span', { className: 'question-tag' }, 'Question'),
    el('span', { className: 'question-summary' }, summarizeQuestion(question))
  );

  var body = el('div', { className: 'question-body' },
    el('div', { className: 'question-full' }, question)
  );

  makeToggle(header, body);
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function renderVerdict(synthesis, meta, opinions) {
  if (!synthesis) return null;

  var section = el('div', { className: 'verdict' });

  // Main verdict box
  var main = el('div', { className: 'verdict-main' });
  main.appendChild(el('div', { className: 'section-label' }, 'Verdict'));
  main.appendChild(el('div', { className: 'verdict-rec' }, synthesis.recommendation));

  var grid = el('div', { className: 'verdict-grid' });

  if (synthesis.consensus) {
    var cCard = el('div', { className: 'verdict-card verdict-card--consensus' });
    cCard.appendChild(el('div', { className: 'verdict-card-label' }, 'Consensus'));
    cCard.appendChild(el('div', { className: 'verdict-card-text' }, synthesis.consensus));
    grid.appendChild(cCard);
  }

  if (synthesis.divergence) {
    var dCard = el('div', { className: 'verdict-card verdict-card--divergence' });
    dCard.appendChild(el('div', { className: 'verdict-card-label' }, 'Divergence'));
    dCard.appendChild(el('div', { className: 'verdict-card-text' }, synthesis.divergence));
    grid.appendChild(dCard);
  }

  main.appendChild(grid);
  section.appendChild(main);

  // Meta strip
  var strip = el('div', { className: 'meta-strip' });

  // Confidence
  strip.appendChild(el('div', { className: 'meta-chip' },
    el('span', { className: 'meta-chip-label' }, 'Confidence'),
    el('span', { className: 'meta-chip-value meta-chip-value--accent' }, confLabel(synthesis.confidence))
  ));

  // Chairman
  if (meta.chairman) {
    var chairCfg = AGENTS[meta.chairman] || { label: meta.chairman };
    strip.appendChild(el('div', { className: 'meta-chip' },
      el('span', { className: 'meta-chip-label' }, 'Chairman'),
      el('span', { className: 'meta-chip-value' }, chairCfg.label)
    ));
  }

  // Duration
  var maxDur = 0;
  for (var i = 0; i < opinions.length; i++) {
    if (opinions[i].duration_ms > maxDur) maxDur = opinions[i].duration_ms;
  }
  if (maxDur) {
    var okCount = 0;
    for (var j = 0; j < opinions.length; j++) {
      if (opinions[j].status === 'ok') okCount++;
    }
    strip.appendChild(el('div', { className: 'meta-chip' },
      el('span', { className: 'meta-chip-label' }, 'Wall clock'),
      el('span', { className: 'meta-chip-value' }, formatDuration(maxDur)),
      el('span', { className: 'meta-chip-detail' }, okCount + '/' + opinions.length)
    ));
  }

  // Date
  strip.appendChild(el('div', { className: 'meta-chip' },
    el('span', { className: 'meta-chip-label' }, 'Date'),
    el('span', { className: 'meta-chip-value' }, formatDate(meta.created_at))
  ));

  // Mode
  if (meta.mode) {
    strip.appendChild(el('div', { className: 'meta-chip' },
      el('span', { className: 'meta-chip-label' }, 'Mode'),
      el('span', { className: 'meta-chip-value' }, meta.mode)
    ));
  }

  section.appendChild(strip);
  return section;
}

function renderOpinions(opinions) {
  var section = el('div', { className: 'opinions' });
  section.appendChild(el('div', { className: 'section-label' }, 'Agent Opinions'));

  var tabBar = el('div', { className: 'opinions-tabs', role: 'tablist' });
  var panels = [];
  var tabs = [];

  for (var i = 0; i < opinions.length; i++) {
    var op = opinions[i];
    var cfg = AGENTS[op.agent] || { label: op.agent, color: 'var(--on-surface-3)', bg: 'var(--surface-low)' };

    // Tab button
    var tab = el('button', {
      className: 'opinion-tab',
      role: 'tab',
      'aria-selected': i === 0 ? 'true' : 'false',
      tabindex: i === 0 ? '0' : '-1'
    },
      el('span', { className: 'agent-dot', style: { background: cfg.color } }),
      document.createTextNode(cfg.label),
      el('span', { className: 'opinion-tab-meta' }, formatDuration(op.duration_ms))
    );

    tab.style.setProperty('--tab-color', cfg.color);
    tabBar.appendChild(tab);
    tabs.push(tab);

    // Panel
    var panel = el('div', {
      className: 'opinion-panel' + (i === 0 ? ' active' : ''),
      role: 'tabpanel'
    });

    var body = el('div', { className: 'agent-card-body' });

    if (op.status !== 'ok') {
      body.appendChild(el('div', { className: 'agent-sub' },
        el('div', { style: { color: 'var(--error)', fontFamily: 'var(--font-label)', fontSize: '0.75rem' } },
          'Agent returned ' + op.status + (op.error ? ': ' + op.error : ''))
      ));
      panel.appendChild(body);
      panels.push(panel);
      continue;
    }

    // Recommendation
    var recSub = el('div', { className: 'agent-sub' });
    recSub.appendChild(el('div', { className: 'agent-sub-label' }, 'Recommendation'));
    recSub.appendChild(el('div', { className: 'agent-sub-text' }, stripMd(op.recommendation || op.response.slice(0, 300))));
    body.appendChild(recSub);

    // Full reasoning trace — collapsed
    if (op.response) {
      var trSub = el('div', { className: 'agent-sub' });
      var trToggle = el('button', { className: 'transcript-toggle' });
      var trChev = el('span', null, '\\u25b8');
      trToggle.appendChild(trChev);
      trToggle.appendChild(document.createTextNode(' Reasoning trace'));

      var trBody = el('div', { className: 'transcript-body' });
      trBody.appendChild(el('pre', { className: 'transcript-text' }, op.response));

      (function(chev, tbody) {
        trToggle.addEventListener('click', function() {
          var open = tbody.classList.toggle('open');
          chev.textContent = open ? '\\u25be' : '\\u25b8';
        });
      })(trChev, trBody);

      trSub.appendChild(trToggle);
      trSub.appendChild(trBody);
      body.appendChild(trSub);
    }

    // Confidence badge
    if (op.confidence) {
      var level = confLevel(op.confidence);
      var badge = el('span', { className: 'confidence-badge confidence-' + level }, confLabel(op.confidence));
      body.appendChild(el('div', { className: 'agent-sub', style: { marginBottom: '0.6rem' } }, badge));
    }

    // Reasoning
    if (op.reasoning && op.reasoning.length) {
      var rSub = el('div', { className: 'agent-sub' });
      rSub.appendChild(el('div', { className: 'agent-sub-label' }, 'Reasoning'));
      for (var ri = 0; ri < op.reasoning.length; ri++) {
        rSub.appendChild(el('div', { className: 'reasoning-bullet' }, stripMd(op.reasoning[ri])));
      }
      body.appendChild(rSub);
    }

    // Assumptions
    if (op.assumptions && op.assumptions.length) {
      var aSub = el('div', { className: 'agent-sub' });
      aSub.appendChild(el('div', { className: 'agent-sub-label' }, 'Assumptions'));
      var chips = el('div');
      for (var ai = 0; ai < op.assumptions.length; ai++) {
        chips.appendChild(el('span', { className: 'assumption-chip' }, stripMd(op.assumptions[ai])));
      }
      aSub.appendChild(chips);
      body.appendChild(aSub);
    }

    // Tradeoffs
    if (op.tradeoffs) {
      var tSub = el('div', { className: 'agent-sub' });
      tSub.appendChild(el('div', { className: 'agent-sub-label' }, 'Tradeoffs'));
      tSub.appendChild(el('div', { className: 'agent-sub-text' }, stripMd(op.tradeoffs)));
      body.appendChild(tSub);
    }

    // Belief update trigger
    if (op.belief_update_trigger) {
      var bSub = el('div', { className: 'agent-sub' });
      bSub.appendChild(el('div', { className: 'agent-sub-label' }, 'What would change my mind'));
      bSub.appendChild(el('div', { className: 'belief-trigger' }, stripMd(op.belief_update_trigger)));
      body.appendChild(bSub);
    }

    // Dissent
    if (op.dissent_points) {
      var dissent = el('div', { className: 'dissent-block', style: {
        borderColor: cfg.color, background: cfg.bg
      }});
      dissent.appendChild(el('div', { className: 'dissent-label', style: { color: cfg.color } }, 'Dissent'));
      dissent.appendChild(el('div', { className: 'dissent-text' }, stripMd(op.dissent_points)));
      body.appendChild(dissent);
    }

    panel.appendChild(body);
    panels.push(panel);
  }

  // Tab switching logic
  function activateTab(index) {
    for (var ti = 0; ti < tabs.length; ti++) {
      tabs[ti].setAttribute('aria-selected', ti === index ? 'true' : 'false');
      tabs[ti].setAttribute('tabindex', ti === index ? '0' : '-1');
    }
    for (var pi = 0; pi < panels.length; pi++) {
      if (pi === index) panels[pi].classList.add('active');
      else panels[pi].classList.remove('active');
    }
  }

  for (var ti = 0; ti < tabs.length; ti++) {
    (function(idx) {
      tabs[idx].addEventListener('click', function() { activateTab(idx); });
      tabs[idx].addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); var next = (idx + 1) % tabs.length; activateTab(next); tabs[next].focus(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); var prev = (idx - 1 + tabs.length) % tabs.length; activateTab(prev); tabs[prev].focus(); }
      });
    })(ti);
  }

  section.appendChild(tabBar);
  for (var p = 0; p < panels.length; p++) section.appendChild(panels[p]);
  return section;
}

function renderReviews(reviews) {
  if (!reviews || !reviews.length) return null;

  var section = el('div', { className: 'reviews' });
  section.appendChild(el('div', { className: 'section-label' }, 'Peer Reviews'));

  // Check if reviews have structured scores (matrix format)
  if (reviews.scores && reviews.responseLabels) {
    return renderReviewMatrix(reviews, section);
  }

  // Flat format: each review is an AgentResult with response text
  for (var i = 0; i < reviews.length; i++) {
    var r = reviews[i];
    var cfg = AGENTS[r.agent] || { label: r.agent, color: 'var(--on-surface-3)' };

    var item = el('div', { className: 'review-flat' });

    var header = el('div', { className: 'review-flat-header' },
      el('span', { className: 'agent-dot', style: { background: cfg.color } }),
      el('span', { className: 'review-flat-name', style: { color: cfg.color } }, cfg.label),
      el('span', { className: 'review-flat-meta' }, formatDuration(r.duration_ms))
    );
    item.appendChild(header);

    // Collapsible response
    var toggle = el('button', { className: 'transcript-toggle' });
    var chev = el('span', null, '\\u25b8');
    toggle.appendChild(chev);
    toggle.appendChild(document.createTextNode(' Review details'));

    var tbody = el('div', { className: 'transcript-body' });
    tbody.appendChild(el('pre', { className: 'transcript-text' }, r.response));

    (function(ch, tb) {
      toggle.addEventListener('click', function() {
        var open = tb.classList.toggle('open');
        ch.textContent = open ? '\\u25be' : '\\u25b8';
      });
    })(chev, tbody);

    item.appendChild(toggle);
    item.appendChild(tbody);
    section.appendChild(item);
  }

  return section;
}

function renderReviewMatrix(reviews, section) {
  var reviewers = reviews.scores;
  var responses = reviews.responseLabels;
  var dims = ['correctness', 'completeness', 'feasibility'];
  var dimLabels = ['COR', 'CMP', 'FEA'];

  var matrix = el('div', { className: 'review-matrix', style: {
    gridTemplateColumns: '160px ' + responses.map(function() { return '1fr'; }).join(' ')
  }});

  // Corner cell
  var corner = el('div', { className: 'rm-corner' });
  corner.appendChild(el('span', { style: {
    fontFamily: 'var(--font-label)', fontSize: '0.5rem', color: 'var(--on-surface-3)',
    textTransform: 'uppercase', letterSpacing: '0.08em'
  }}, 'Reviewer \\u2193  Opinion \\u2192'));
  matrix.appendChild(corner);

  // Column headers
  for (var ci = 0; ci < responses.length; ci++) {
    var respAgent = responses[ci];
    var respCfg = AGENTS[respAgent] || { label: respAgent, color: 'var(--on-surface-3)' };
    var head = el('div', { className: 'rm-col-head' },
      el('span', { className: 'agent-dot', style: { background: respCfg.color } }),
      el('span', { className: 'rm-col-label', style: { color: respCfg.color } }, respCfg.label),
      el('span', { className: 'rm-col-sub' }, 'opinion')
    );
    matrix.appendChild(head);
  }

  // Data rows
  for (var ri = 0; ri < reviewers.length; ri++) {
    var rev = reviewers[ri];
    var reviewerCfg = AGENTS[rev.reviewer] || { label: rev.reviewer, color: 'var(--on-surface-3)' };

    var rowHead = el('div', { className: 'rm-row-head' },
      el('span', { className: 'agent-dot', style: { background: reviewerCfg.color } }),
      el('span', { className: 'rm-row-label', style: { color: reviewerCfg.color } }, reviewerCfg.label),
      el('span', { className: 'rm-row-sub' }, formatDuration(rev.duration_ms))
    );
    matrix.appendChild(rowHead);

    for (var si = 0; si < responses.length; si++) {
      var respAgent2 = responses[si];
      var grade = null;
      for (var gi = 0; gi < rev.grades.length; gi++) {
        if (rev.grades[gi].response === respAgent2) { grade = rev.grades[gi]; break; }
      }

      var cell = el('div', { className: 'rm-cell' });

      if (grade) {
        var scores = el('div', { className: 'rm-scores' });
        var vals = [grade.correctness, grade.completeness, grade.feasibility];

        for (var d = 0; d < dims.length; d++) {
          var v = vals[d];
          var pip = el('div', { className: 'rm-score-pip rm-score-' + v }, String(v));
          var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' } },
            pip,
            el('span', { className: 'rm-score-dim' }, dimLabels[d])
          );
          scores.appendChild(wrap);
        }
        cell.appendChild(scores);

        if (grade.note) {
          cell.appendChild(el('div', { className: 'rm-note' }, grade.note));
        }
      }

      matrix.appendChild(cell);
    }
  }

  section.appendChild(matrix);

  // Rankings
  var rankSection = el('div', { className: 'review-rankings' });
  for (var rki = 0; rki < reviewers.length; rki++) {
    var revk = reviewers[rki];
    var rkCfg = AGENTS[revk.reviewer] || { label: revk.reviewer, color: 'var(--on-surface-3)' };
    var card = el('div', { className: 'ranking-card' });

    card.appendChild(el('div', { className: 'ranking-reviewer' },
      el('span', { className: 'agent-dot', style: { background: rkCfg.color } }),
      el('span', { className: 'ranking-reviewer-label', style: { color: rkCfg.color } }, rkCfg.label + "'s ranking")
    ));

    if (revk.ranking) {
      var list = el('ul', { className: 'ranking-list' });
      for (var rr = 0; rr < revk.ranking.length; rr++) {
        var rankedCfg = AGENTS[revk.ranking[rr]] || { label: revk.ranking[rr], color: 'var(--on-surface-3)' };
        list.appendChild(el('li', { className: 'ranking-item' },
          el('span', { className: 'ranking-pos ranking-pos-' + (rr + 1) }, String(rr + 1)),
          el('span', { style: { color: rankedCfg.color, fontWeight: '600' } }, rankedCfg.label)
        ));
      }
      card.appendChild(list);
    }
    rankSection.appendChild(card);
  }

  section.appendChild(rankSection);
  return section;
}

function renderNudges(nudges) {
  if (!nudges || !nudges.length) return null;

  var section = el('div', { className: 'nudges' });
  section.appendChild(el('div', { className: 'section-label' }, 'Corrections'));

  for (var i = 0; i < nudges.length; i++) {
    var n = nudges[i];
    var cfg = AGENTS[n.agent] || { label: n.agent, color: 'var(--primary)' };

    var item = el('div', { className: 'timeline-item' });

    // Rail with dot and connecting line
    var rail = el('div', { className: 'timeline-rail' });
    rail.appendChild(el('div', { className: 'timeline-dot', style: { background: cfg.color } }, '\\u270e'));
    if (i < nudges.length - 1) rail.appendChild(el('div', { className: 'timeline-line' }));
    item.appendChild(rail);

    // Content
    var content = el('div', { className: 'timeline-content' });

    // Header: agent name + timestamp
    var labelEl = el('div', { className: 'timeline-label' });
    labelEl.appendChild(el('span', { style: { color: cfg.color } }, cfg.label));
    labelEl.appendChild(document.createTextNode(' \\u2014 corrected'));
    content.appendChild(labelEl);
    if (n.timestamp) content.appendChild(el('div', { className: 'timeline-time' }, formatDate(n.timestamp)));

    // The correction
    var corrCard = el('div', { className: 'timeline-card' });
    corrCard.appendChild(el('div', { style: {
      fontFamily: 'var(--font-label)', fontSize: '0.5rem', fontWeight: '600',
      letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--on-surface-3)',
      marginBottom: '0.3rem'
    }}, 'User correction'));
    corrCard.appendChild(el('p', { style: { fontStyle: 'italic' } }, '\\u201c' + n.correction + '\\u201d'));
    content.appendChild(corrCard);

    // Before -> After
    if (n.original_recommendation || n.recommendation) {
      var diffCard = el('div', { className: 'timeline-card', style: { marginTop: '0.5rem' } });

      if (n.original_recommendation) {
        diffCard.appendChild(el('div', { style: {
          fontFamily: 'var(--font-label)', fontSize: '0.5rem', fontWeight: '600',
          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--error)',
          marginBottom: '0.25rem'
        }}, 'Before'));
        diffCard.appendChild(el('p', { style: {
          fontSize: '0.82rem', color: 'var(--on-surface-3)',
          textDecoration: 'line-through', marginBottom: '0.75rem'
        }}, stripMd(n.original_recommendation)));
      }

      if (n.recommendation) {
        diffCard.appendChild(el('div', { style: {
          fontFamily: 'var(--font-label)', fontSize: '0.5rem', fontWeight: '600',
          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--tertiary)',
          marginBottom: '0.25rem'
        }}, 'After'));
        diffCard.appendChild(el('p', { style: {
          fontSize: '0.85rem', color: 'var(--on-surface)'
        }}, stripMd(n.recommendation)));
      }

      content.appendChild(diffCard);
    }

    // What changed — collapsible
    if (n.what_changed) {
      var wcToggle = el('button', { className: 'transcript-toggle', style: { marginTop: '0.5rem' } });
      var wcChev = el('span', null, '\\u25b8');
      wcToggle.appendChild(wcChev);
      wcToggle.appendChild(document.createTextNode(' What changed'));

      var wcBody = el('div', { className: 'transcript-body' });
      wcBody.appendChild(el('div', { style: {
        fontFamily: 'var(--font-body)', fontSize: '0.85rem', lineHeight: '1.65',
        color: 'var(--on-surface-2)', padding: '0.6rem 0.75rem',
        background: 'var(--surface-low)', borderRadius: 'var(--radius-sm)',
        marginTop: '0.35rem'
      }}, n.what_changed));

      (function(ch, tb) {
        wcToggle.addEventListener('click', function() {
          var open = tb.classList.toggle('open');
          ch.textContent = open ? '\\u25be' : '\\u25b8';
        });
      })(wcChev, wcBody);

      content.appendChild(wcToggle);
      content.appendChild(wcBody);
    }

    item.appendChild(content);
    section.appendChild(item);
  }

  return section;
}

function renderOutcome(outcome) {
  if (!outcome) return null;
  var section = el('div', { className: 'outcome' });
  section.appendChild(el('div', { className: 'section-label' }, 'What happened'));
  var body = el('div', { className: 'outcome-body' });
  body.appendChild(el('div', { className: 'outcome-text' }, outcome.result));
  if (outcome.recorded_at) body.appendChild(el('div', { className: 'outcome-ts' }, 'Recorded ' + formatDate(outcome.recorded_at)));
  section.appendChild(body);
  return section;
}

// ════════════════════════════════════════
// MOUNT
// ════════════════════════════════════════
function render() {
  initTheme();
  var app = document.getElementById('app');

  app.appendChild(renderTopbar(D.meta));
  app.appendChild(renderQuestion(D.meta.question));

  var verdict = renderVerdict(D.synthesis, D.meta, D.opinions);
  if (verdict) app.appendChild(verdict);

  app.appendChild(renderOpinions(D.opinions));

  var reviews = renderReviews(D.reviews);
  if (reviews) app.appendChild(reviews);

  var nudges = renderNudges(D.nudges);
  if (nudges) app.appendChild(nudges);

  var outcome = renderOutcome(D.meta.outcome);
  if (outcome) app.appendChild(outcome);
}

render();
</script>
</body>
</html>`;

  const viewerPath = resolve(sessionDir, "viewer.html");
  Bun.write(viewerPath, html);
  console.error(`Viewer: ${viewerPath}`);
}
