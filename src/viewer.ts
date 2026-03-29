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
      tradeoffs: o.tradeoffs,
      confidence: o.confidence,
      dissent_points: o.dissent_points,
      response: o.response,
      error: o.error,
      duration_ms: o.duration_ms,
    })),
    synthesis,
    reviews: reviews.map((r) => ({ agent: r.agent, status: r.status, response: r.response, duration_ms: r.duration_ms })),
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
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --bg: #ffffff; --bg-subtle: #f7f7f8; --bg-hover: #f0f0f2;
    --border: #e5e5e7; --border-light: #eeeff1;
    --text: #1d1d1f; --text-secondary: #6e6e73; --text-tertiary: #aeaeb2; --text-dim: #c7c7cc;
    --green: #28a745; --green-light: #dcfce7;
    --amber: #b45309; --amber-light: #fef3c7;
    --purple: #7c3aed; --blue: #2563eb; --teal: #0d9488;
    --raw-bg: #f7f7f8;
  }
  html.dark {
    --bg: #111113; --bg-subtle: #1a1a1e; --bg-hover: #222228;
    --border: #2a2a2e; --border-light: #222226;
    --text: #e4e4e7; --text-secondary: #a1a1a6; --text-tertiary: #63636a; --text-dim: #45454a;
    --green: #4ade80; --green-light: rgba(74,222,128,0.1);
    --amber: #fbbf24; --amber-light: rgba(251,191,36,0.1);
    --raw-bg: #151518;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); line-height: 1.65; -webkit-font-smoothing: antialiased; }
  .container { max-width: 1080px; margin: 0 auto; padding: 2.5rem 2.5rem 4rem; }

  .report-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-light); }
  .report-bar-left { display: flex; align-items: center; gap: 0.75rem; }
  .report-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
  .report-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; color: var(--text-secondary); }
  .report-meta { font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; color: var(--text-tertiary); }

  .kpi-strip { display: flex; gap: 0; margin-bottom: 2rem; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .kpi { flex: 1; padding: 0.75rem 1rem; border-right: 1px solid var(--border-light); text-align: center; }
  .kpi:last-child { border-right: none; }
  .kpi-val { font-size: 1.1rem; font-weight: 700; color: var(--text); }
  .kpi-val.green { color: var(--green); }
  .kpi-val.amber { color: var(--amber); }
  .kpi-label { font-size: 0.6rem; color: var(--text-tertiary); letter-spacing: 0.03em; margin-top: 0.1rem; }

  .question { font-size: 1.65rem; font-weight: 700; color: var(--text); line-height: 1.35; margin-bottom: 2rem; letter-spacing: -0.015em; }

  .outcome-banner { background: var(--amber-light); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.75rem; }
  .outcome-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); flex-shrink: 0; }
  .outcome-text { font-size: 0.85rem; color: var(--text); flex: 1; }
  .outcome-date { font-size: 0.62rem; color: var(--text-tertiary); font-family: 'JetBrains Mono', monospace; }

  .verdict { background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 2.5rem; }
  .verdict-label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--green); margin-bottom: 0.5rem; }
  .verdict-pending { font-size: 0.9rem; color: var(--text-tertiary); font-style: italic; }
  .verdict-text { font-size: 1.1rem; font-weight: 500; color: var(--text); line-height: 1.55; }
  .verdict-findings { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--border-light); }
  .vf-label { font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 0.25rem; }
  .vf-label.consensus { color: var(--green); }
  .vf-label.divergence { color: var(--amber); }
  .vf-text { font-size: 0.82rem; color: var(--text-secondary); }

  .section-header { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.75rem; }
  .section-header::after { content: ""; flex: 1; height: 1px; background: var(--border-light); }

  .agents-stack { display: flex; flex-direction: column; gap: 1.25rem; }
  .agent-msg { }
  .agent-bar { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
  .agent-avatar { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0; }
  .agent-avatar.claude { color: var(--purple); }
  .agent-avatar.codex { color: var(--teal); }
  .agent-avatar.gemini { color: var(--blue); }
  .agent-name { font-size: 0.78rem; font-weight: 600; color: var(--text); }
  .agent-meta { font-size: 0.62rem; color: var(--text-tertiary); }
  .agent-conf-tag { font-size: 0.55rem; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: var(--green-light); color: var(--green); }
  .agent-error-tag { font-size: 0.55rem; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: rgba(248,81,73,0.1); color: #f85149; }

  .agent-rec { margin-top: 0.5rem; font-size: 0.95rem; color: var(--text); font-weight: 500; line-height: 1.55; margin-bottom: 0.35rem; }
  .agent-error { margin-top: 0.5rem; font-size: 0.85rem; color: #f85149; }

  .agent-depth { border: 1px solid var(--border-light); border-radius: 8px; overflow: hidden; margin-top: 0.5rem; }
  .depth-toggle { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; cursor: pointer; user-select: none; font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-subtle); }
  .depth-toggle:hover { background: var(--bg-hover); }
  .depth-chevron { font-size: 0.6rem; color: var(--text-dim); transition: transform 0.2s; }
  .depth-chevron.open { transform: rotate(90deg); }
  .depth-body { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
  .depth-body.open { max-height: 5000px; }

  .depth-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-light); background: var(--bg-subtle); }
  .depth-tab { padding: 0.4rem 0.85rem; font-size: 0.62rem; font-weight: 600; color: var(--text-tertiary); cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; user-select: none; }
  .depth-tab:hover { color: var(--text-secondary); }
  .depth-tab.active { color: var(--text); border-bottom-color: var(--text); }
  .depth-panel { display: none; padding: 0.75rem; }
  .depth-panel.active { display: block; }

  .depth-section { margin-bottom: 0.75rem; }
  .depth-section:last-child { margin-bottom: 0; }
  .depth-section-label { font-size: 0.58rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 0.3rem; }
  .depth-section-text { font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6; }
  .depth-section-text ul { padding-left: 1.25rem; }
  .depth-section-text li { margin-bottom: 0.3rem; }

  .raw-text { font-size: 0.78rem; color: var(--text-secondary); white-space: pre-wrap; font-family: 'JetBrains Mono', monospace; line-height: 1.55; padding: 0.5rem 0; max-height: 500px; overflow-y: auto; }

  .revisit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .revisit-col { background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; }
  .revisit-col-header { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 0.75rem; }
  .revisit-original .revisit-col-header { color: var(--text-tertiary); }
  .revisit-current .revisit-col-header { color: var(--green); }
  .revisit-item { margin-bottom: 0.75rem; }
  .revisit-item-label { font-size: 0.6rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .revisit-item-value { font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.2rem; }

  .theme-toggle { width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-subtle); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; transition: background 0.15s; color: var(--text-secondary); }
  .theme-toggle:hover { background: var(--bg-hover); }

  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border-light); display: flex; justify-content: space-between; font-size: 0.6rem; color: var(--text-dim); }

  @media (max-width: 768px) {
    .container { padding: 1.5rem 1rem; }
    .question { font-size: 1.2rem; }
    .kpi-strip { flex-wrap: wrap; }
    .kpi { flex-basis: 50%; border-bottom: 1px solid var(--border-light); }
    .verdict-findings { grid-template-columns: 1fr; }
    .revisit-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="report-bar">
    <div class="report-bar-left">
      <div class="report-dot"></div>
      <span class="report-label">Agent Council</span>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <span class="report-meta" id="meta"></span>
      <button class="theme-toggle" id="themeToggle" title="Toggle dark mode">\\u2600</button>
    </div>
  </div>
  <div class="kpi-strip" id="kpis"></div>
  <div id="outcomeBanner"></div>
  <div class="question" id="question"></div>
  <div class="verdict" id="verdict"></div>
  <div class="section-header">Council Deliberation</div>
  <div id="agents" class="agents-stack"></div>
  <div id="revisitSection"></div>
  <div class="footer">
    <span id="footerLeft"></span>
    <span>Agent Council v0.1.0</span>
  </div>
</div>

<script>
  const DATA = ${escapeJsonForScript(viewerData)};
  const ICONS = { claude: '\\u2b22', codex: '\\u2b23', gemini: '\\u25c6' };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  // Meta
  document.getElementById('meta').textContent = DATA.meta.id + ' \\u00b7 ' + DATA.meta.created_at.split('T')[0];

  // KPIs
  const kpis = document.getElementById('kpis');
  const confLevel = DATA.synthesis ? DATA.synthesis.confidence : (DATA.successCount > 0 ? 'pending' : 'none');
  [
    { val: DATA.successCount + '/' + DATA.opinions.length, label: 'Agents', cls: '' },
    { val: DATA.successCount + '/' + DATA.opinions.length, label: 'Responded', cls: DATA.successCount === DATA.opinions.length ? 'green' : 'amber' },
    { val: confLevel.charAt(0).toUpperCase() + confLevel.slice(1), label: 'Consensus', cls: confLevel === 'high' ? 'green' : confLevel === 'low' ? 'amber' : '' },
    { val: (DATA.totalDuration / 1000).toFixed(0) + 's', label: 'Wall Clock', cls: 'amber' }
  ].forEach(k => {
    const d = h('div', 'kpi');
    d.appendChild(h('div', 'kpi-val' + (k.cls ? ' ' + k.cls : ''), k.val));
    d.appendChild(h('div', 'kpi-label', k.label));
    kpis.appendChild(d);
  });

  // Outcome banner
  if (DATA.meta.outcome) {
    const banner = h('div', 'outcome-banner');
    banner.appendChild(h('div', 'outcome-dot'));
    banner.appendChild(h('div', 'outcome-text', DATA.meta.outcome.result));
    banner.appendChild(h('div', 'outcome-date', DATA.meta.outcome.recorded_at.split('T')[0]));
    document.getElementById('outcomeBanner').appendChild(banner);
  }

  // Question
  document.getElementById('question').textContent = DATA.meta.question;

  // Verdict
  const vd = document.getElementById('verdict');
  if (DATA.synthesis) {
    vd.appendChild(h('div', 'verdict-label', 'Council Verdict'));
    vd.appendChild(h('div', 'verdict-text', DATA.synthesis.recommendation));
    const findings = h('div', 'verdict-findings');
    const cf = h('div');
    cf.appendChild(h('div', 'vf-label consensus', 'Consensus'));
    cf.appendChild(h('div', 'vf-text', DATA.synthesis.consensus));
    findings.appendChild(cf);
    const df = h('div');
    df.appendChild(h('div', 'vf-label divergence', 'Divergence'));
    df.appendChild(h('div', 'vf-text', DATA.synthesis.divergence));
    findings.appendChild(df);
    vd.appendChild(findings);
  } else {
    vd.appendChild(h('div', 'verdict-label', 'Council Verdict'));
    vd.appendChild(h('div', 'verdict-pending', 'Synthesis pending. The chairman will produce this after reviewing all opinions.'));
  }

  // Agents
  const agents = document.getElementById('agents');
  const sorted = [...DATA.opinions].sort((a, b) => a.duration_ms - b.duration_ms);

  sorted.forEach(op => {
    const msg = h('div', 'agent-msg');
    const bar = h('div', 'agent-bar');
    bar.appendChild(h('div', 'agent-avatar ' + op.agent, ICONS[op.agent] || '\\u25cf'));
    bar.appendChild(h('span', 'agent-name', op.agent.charAt(0).toUpperCase() + op.agent.slice(1)));
    bar.appendChild(h('span', 'agent-meta', (op.duration_ms / 1000).toFixed(1) + 's'));
    if (op.status === 'ok') {
      const confText = op.confidence ? op.confidence.toLowerCase().split(/[^a-z]/)[0] : '';
      bar.appendChild(h('span', 'agent-conf-tag', confText.charAt(0).toUpperCase() + confText.slice(1) || 'OK'));
    } else {
      bar.appendChild(h('span', 'agent-error-tag', op.status.toUpperCase()));
    }
    msg.appendChild(bar);

    if (op.status === 'ok') {
      msg.appendChild(h('div', 'agent-rec', op.recommendation || op.response.slice(0, 200)));

      const depth = h('div', 'agent-depth');
      const toggle = h('div', 'depth-toggle');
      toggle.appendChild(h('span', null, 'Explore reasoning'));
      const chevron = h('span', 'depth-chevron', '\\u25b8');
      toggle.appendChild(chevron);
      depth.appendChild(toggle);

      const body = h('div', 'depth-body');
      const tabBar = h('div', 'depth-tabs');
      const panels = [];

      function addTab(label, content, isDefault) {
        const tab = h('div', 'depth-tab' + (isDefault ? ' active' : ''), label);
        tabBar.appendChild(tab);
        const panel = h('div', 'depth-panel' + (isDefault ? ' active' : ''));
        panel.appendChild(content);
        panels.push({ tab, panel });
        tab.addEventListener('click', () => {
          panels.forEach(p => { p.tab.classList.remove('active'); p.panel.classList.remove('active'); });
          tab.classList.add('active'); panel.classList.add('active');
        });
      }

      // Tab: Reasoning
      const rc = h('div');
      if (op.reasoning && op.reasoning.length) {
        const sec = h('div', 'depth-section');
        sec.appendChild(h('div', 'depth-section-label', 'Reasoning'));
        const ct = h('div', 'depth-section-text');
        const ul = document.createElement('ul');
        op.reasoning.forEach(r => { const li = document.createElement('li'); li.textContent = r; ul.appendChild(li); });
        ct.appendChild(ul); sec.appendChild(ct); rc.appendChild(sec);
      }
      if (op.confidence) {
        const sec = h('div', 'depth-section');
        sec.appendChild(h('div', 'depth-section-label', 'Confidence'));
        const p = h('div', 'depth-section-text'); p.textContent = op.confidence;
        sec.appendChild(p); rc.appendChild(sec);
      }
      addTab('Reasoning', rc, true);

      // Tab: Trade-offs
      const tc = h('div');
      if (op.tradeoffs) {
        const sec = h('div', 'depth-section');
        sec.appendChild(h('div', 'depth-section-label', 'Trade-offs'));
        const p = h('div', 'depth-section-text'); p.textContent = op.tradeoffs;
        sec.appendChild(p); tc.appendChild(sec);
      }
      if (op.dissent_points) {
        const sec = h('div', 'depth-section');
        sec.appendChild(h('div', 'depth-section-label', 'Strongest Counter-argument'));
        const p = h('div', 'depth-section-text'); p.textContent = op.dissent_points;
        sec.appendChild(p); tc.appendChild(sec);
      }
      addTab('Trade-offs', tc, false);

      // Tab: Full Response
      const raw = h('div', 'raw-text'); raw.textContent = op.response;
      addTab('Full Response', raw, false);

      body.appendChild(tabBar);
      panels.forEach(p => body.appendChild(p.panel));
      depth.appendChild(body);
      toggle.addEventListener('click', () => { body.classList.toggle('open'); chevron.classList.toggle('open'); });
      msg.appendChild(depth);
    } else {
      msg.appendChild(h('div', 'agent-error', op.error || 'Unknown error'));
    }
    agents.appendChild(msg);
  });

  // Revisit diff
  if (DATA.parentSession) {
    const rs = document.getElementById('revisitSection');
    rs.appendChild(h('div', 'section-header', 'Revisit Comparison'));
    const grid = h('div', 'revisit-grid');

    const origCol = h('div', 'revisit-col revisit-original');
    const origH = h('div', 'revisit-col-header');
    origH.textContent = 'Original (' + DATA.parentSession.meta.created_at.split('T')[0] + ')';
    origCol.appendChild(origH);
    DATA.parentSession.opinions.forEach(op => {
      if (op.status !== 'ok') return;
      const item = h('div', 'revisit-item');
      item.appendChild(h('div', 'revisit-item-label', op.agent));
      item.appendChild(h('div', 'revisit-item-value', op.recommendation || op.response.slice(0, 200)));
      origCol.appendChild(item);
    });
    grid.appendChild(origCol);

    const curCol = h('div', 'revisit-col revisit-current');
    const curH = h('div', 'revisit-col-header');
    curH.textContent = 'Revisit (' + DATA.meta.created_at.split('T')[0] + ')';
    curCol.appendChild(curH);
    DATA.opinions.forEach(op => {
      if (op.status !== 'ok') return;
      const item = h('div', 'revisit-item');
      item.appendChild(h('div', 'revisit-item-label', op.agent));
      item.appendChild(h('div', 'revisit-item-value', op.recommendation || op.response.slice(0, 200)));
      curCol.appendChild(item);
    });
    grid.appendChild(curCol);
    rs.appendChild(grid);
  }

  // Footer
  document.getElementById('footerLeft').textContent =
    DATA.meta.created_at.split('T')[0] + ' \\u00b7 ' + DATA.meta.mode + ' mode \\u00b7 council replay ' + DATA.meta.id;

  // Theme toggle
  const themeBtn = document.getElementById('themeToggle');
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    themeBtn.textContent = dark ? '\\u263e' : '\\u2600';
    themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    try { localStorage.setItem('council-theme', dark ? 'dark' : 'light'); } catch {}
  }
  const saved = (() => { try { return localStorage.getItem('council-theme'); } catch { return null; } })();
  if (saved === 'dark') applyTheme(true);
  else if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
  themeBtn.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('dark')));
</script>
</body>
</html>`;

  const viewerPath = resolve(sessionDir, "viewer.html");
  Bun.write(viewerPath, html);
  console.error(`Viewer: ${viewerPath}`);
}
