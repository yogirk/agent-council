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
  // Parent dir is a sibling of the current session dir
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
            return {
              agent: op.agent,
              status: op.status,
              recommendation: op.recommendation,
              confidence: op.confidence,
              response: op.response,
            };
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

  // Load parent session if this is a revisit
  const parentSession = meta.parent_id
    ? loadParentSession(sessionDir, meta.parent_id)
    : null;

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
    reviews: reviews.map((r) => ({
      agent: r.agent,
      status: r.status,
      response: r.response,
      duration_ms: r.duration_ms,
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
    :root {
      --bg: #0d1117;
      --bg-card: #161b22;
      --bg-hover: #1c2128;
      --border: #30363d;
      --border-light: #21262d;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --text-muted: #8b949e;
      --text-dim: #484f58;
      --green: #3fb950;
      --green-bg: #1a3a2a;
      --amber: #d29922;
      --amber-bg: #3a2a1a;
      --red: #f85149;
      --red-bg: #3a1a1a;
      --purple: #b47eff;
      --blue: #58a6ff;
      --radius: 8px;
      --radius-sm: 4px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }

    /* --- Header --- */
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .header-left { display: flex; align-items: center; gap: 0.6rem; }
    .logo { width: 10px; height: 10px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); }
    .title { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; }
    .session-id { font-size: 0.75rem; color: var(--text-dim); font-family: "SF Mono", "Fira Code", monospace; }

    /* --- Question --- */
    .question-block {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
      font-size: 1.15rem;
      font-weight: 500;
      color: var(--text-bright);
      line-height: 1.5;
    }

    /* --- Summary bar --- */
    .summary-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      padding: 0.75rem 0;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid var(--border-light);
    }
    .stat { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-muted); }
    .stat-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .stat-dot.green { background: var(--green); }
    .stat-dot.amber { background: var(--amber); }
    .stat-dot.red { background: var(--red); }
    .stat-dot.blue { background: var(--blue); }
    .confidence-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .confidence-high { background: var(--green-bg); color: var(--green); }
    .confidence-medium { background: var(--amber-bg); color: var(--amber); }
    .confidence-low { background: var(--red-bg); color: var(--red); }

    /* --- Stage tabs --- */
    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-light);
    }
    .tab {
      padding: 0.6rem 1.25rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      user-select: none;
    }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--text-bright); border-bottom-color: var(--blue); }
    .tab.disabled { opacity: 0.3; cursor: default; }
    .tab-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 0.4rem; }
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* --- Agent cards grid --- */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 1rem;
    }

    .agent-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .agent-card:hover { border-color: #444c56; }

    .card-header {
      padding: 0.875rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-light);
    }
    .card-header-left { display: flex; align-items: center; gap: 0.5rem; }
    .agent-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .agent-claude { background: rgba(180, 126, 255, 0.15); color: var(--purple); }
    .agent-codex { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .agent-gemini { background: rgba(88, 166, 255, 0.15); color: var(--blue); }
    .card-accent-claude { border-left: 3px solid var(--purple); }
    .card-accent-codex { border-left: 3px solid var(--green); }
    .card-accent-gemini { border-left: 3px solid var(--blue); }
    .card-duration { font-size: 0.75rem; color: var(--text-dim); font-family: "SF Mono", monospace; }
    .card-status-error { color: var(--red); font-size: 0.75rem; font-weight: 600; }

    .card-body { padding: 1rem; }

    /* --- Sections within card --- */
    .card-recommendation {
      font-size: 0.95rem;
      color: var(--text-bright);
      line-height: 1.5;
      margin-bottom: 0.75rem;
    }

    .card-section {
      border-top: 1px solid var(--border-light);
      overflow: hidden;
    }
    .card-section-header {
      padding: 0.5rem 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .card-section-header:hover { color: var(--text-bright); }
    .card-section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .card-section-count {
      font-size: 0.65rem;
      color: var(--text-dim);
      background: var(--bg);
      padding: 1px 6px;
      border-radius: 8px;
    }
    .card-section-chevron {
      font-size: 0.65rem;
      color: var(--text-dim);
      transition: transform 0.2s;
    }
    .card-section-chevron.open { transform: rotate(90deg); }
    .card-section-body {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.25s ease, padding 0.25s ease;
    }
    .card-section-body.open {
      max-height: 800px;
      padding-bottom: 0.5rem;
    }
    .card-section-body ul { padding-left: 1.25rem; }
    .card-section-body li { margin-bottom: 0.3rem; font-size: 0.85rem; color: var(--text); }
    .card-section-body p { font-size: 0.85rem; color: var(--text); white-space: pre-wrap; }
    .card-error { padding: 1rem; color: var(--red); font-size: 0.85rem; }

    /* --- Synthesis panel --- */
    .synthesis-panel {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
    }
    .synthesis-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .synthesis-section { margin-bottom: 1.25rem; }
    .synthesis-section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--blue);
      margin-bottom: 0.35rem;
    }
    .synthesis-section-content { font-size: 0.9rem; color: var(--text); white-space: pre-wrap; line-height: 1.6; }
    .synthesis-pending {
      color: var(--text-dim);
      font-style: italic;
      padding: 2rem;
      text-align: center;
    }

    /* --- Revisit diff --- */
    .revisit-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    @media (max-width: 768px) {
      .revisit-grid { grid-template-columns: 1fr; }
    }
    .revisit-col {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
    }
    .revisit-col-header {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .revisit-original .revisit-col-header { color: var(--text-muted); }
    .revisit-current .revisit-col-header { color: var(--green); }
    .revisit-item { margin-bottom: 0.75rem; }
    .revisit-item-label { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
    .revisit-item-value { font-size: 0.9rem; color: var(--text); margin-top: 0.2rem; }

    /* --- Outcome badge --- */
    .outcome-banner {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .outcome-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--amber); }
    .outcome-text { font-size: 0.85rem; color: var(--text); }
    .outcome-date { font-size: 0.7rem; color: var(--text-dim); margin-left: auto; }

    /* --- Footer --- */
    .footer {
      margin-top: 2.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-light);
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--text-dim);
      font-family: "SF Mono", monospace;
    }

    /* --- Responsive --- */
    @media (max-width: 768px) {
      .container { padding: 1rem; }
      .cards-grid { grid-template-columns: 1fr; }
      .question-block { font-size: 1rem; }
      .summary-bar { gap: 0.75rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <div class="logo"></div>
        <span class="title">Agent Council</span>
      </div>
      <span class="session-id" id="sessionId"></span>
    </div>
    <div class="question-block" id="question"></div>
    <div class="summary-bar" id="summaryBar"></div>
    <div class="tabs" id="tabs"></div>
    <div id="tabPanels"></div>
    <div class="footer">
      <span id="footerLeft"></span>
      <span>Agent Council v0.1.0</span>
    </div>
  </div>

  <script>
    const DATA = ${escapeJsonForScript(viewerData)};
    const AGENT_COLORS = { claude: 'purple', codex: 'codex', gemini: 'gemini' };

    function setText(el, text) { el.textContent = text; }
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }

    // --- Header ---
    setText(document.getElementById('sessionId'), DATA.meta.id);
    setText(document.getElementById('question'), DATA.meta.question);

    // --- Summary bar ---
    const bar = document.getElementById('summaryBar');
    function addStat(dotClass, label) {
      const s = el('div', 'stat');
      const d = el('div', 'stat-dot ' + dotClass);
      s.appendChild(d);
      s.appendChild(el('span', null, label));
      bar.appendChild(s);
    }
    addStat('green', DATA.successCount + '/' + DATA.opinions.length + ' opinions');
    addStat('blue', DATA.meta.mode + ' mode');
    addStat('blue', (DATA.totalDuration / 1000).toFixed(0) + 's wall clock');
    addStat('green', DATA.meta.chairman + ' chairman');

    // --- Tabs ---
    const tabsEl = document.getElementById('tabs');
    const panelsEl = document.getElementById('tabPanels');
    const tabDefs = [
      { id: 'opinions', label: 'Opinions', dot: 'green', enabled: true },
      { id: 'reviews', label: 'Reviews', dot: 'amber', enabled: DATA.reviews.length > 0 },
      { id: 'synthesis', label: 'Synthesis', dot: 'blue', enabled: true },
      { id: 'revisit', label: 'Revisit Diff', dot: 'purple', enabled: !!DATA.parentSession },
    ];

    tabDefs.forEach((td, i) => {
      const tab = el('div', 'tab' + (i === 0 ? ' active' : '') + (!td.enabled ? ' disabled' : ''));
      tab.dataset.tab = td.id;
      const dot = el('span', 'tab-dot');
      const dotColorMap = { green: 'green', amber: 'amber', blue: 'blue', purple: 'purple' };
      dot.style.background = td.enabled ? 'var(--' + (dotColorMap[td.dot] || 'blue') + ')' : 'var(--text-dim)';
      tab.appendChild(dot);
      tab.appendChild(document.createTextNode(td.label));
      if (td.enabled) {
        tab.addEventListener('click', () => switchTab(td.id));
      }
      tabsEl.appendChild(tab);

      const panel = el('div', 'tab-content' + (i === 0 ? ' active' : ''));
      panel.id = 'panel-' + td.id;
      panelsEl.appendChild(panel);
    });

    function switchTab(id) {
      tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
      panelsEl.querySelectorAll('.tab-content').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
    }

    // --- Opinions panel ---
    const opinionsPanel = document.getElementById('panel-opinions');
    const grid = el('div', 'cards-grid');

    DATA.opinions.forEach(op => {
      const agentCls = AGENT_COLORS[op.agent] || 'codex';
      const card = el('div', 'agent-card card-accent-' + agentCls);

      // Card header
      const header = el('div', 'card-header');
      const headerLeft = el('div', 'card-header-left');
      headerLeft.appendChild(el('span', 'agent-badge agent-' + agentCls, op.agent.toUpperCase()));

      if (op.status === 'ok' && op.confidence) {
        const confLevel = op.confidence.toLowerCase().split(/[^a-z]/)[0];
        headerLeft.appendChild(el('span', 'confidence-badge confidence-' + confLevel,
          confLevel.charAt(0).toUpperCase() + confLevel.slice(1)));
      }
      if (op.status !== 'ok') {
        headerLeft.appendChild(el('span', 'card-status-error', op.status.toUpperCase()));
      }
      header.appendChild(headerLeft);
      header.appendChild(el('span', 'card-duration', (op.duration_ms / 1000).toFixed(1) + 's'));
      card.appendChild(header);

      // Card body
      const body = el('div', 'card-body');
      if (op.status === 'ok') {
        if (op.recommendation) {
          body.appendChild(el('div', 'card-recommendation', op.recommendation));
        } else if (!op.structured) {
          const p = el('p', null);
          p.style.fontSize = '0.9rem';
          setText(p, op.response.slice(0, 500) + (op.response.length > 500 ? '...' : ''));
          body.appendChild(p);
        }

        // Collapsible sections
        const sections = [
          { title: 'Reasoning', data: op.reasoning, type: 'list' },
          { title: 'Trade-offs', data: op.tradeoffs, type: 'text' },
          { title: 'Dissent Points', data: op.dissent_points, type: 'text' },
        ];

        sections.forEach(sec => {
          if (!sec.data || (Array.isArray(sec.data) && sec.data.length === 0)) return;
          const section = el('div', 'card-section');
          const sHeader = el('div', 'card-section-header');
          const sLeft = el('div');
          sLeft.style.display = 'flex';
          sLeft.style.alignItems = 'center';
          sLeft.style.gap = '0.5rem';
          sLeft.appendChild(el('span', 'card-section-title', sec.title));
          if (sec.type === 'list' && Array.isArray(sec.data)) {
            sLeft.appendChild(el('span', 'card-section-count', sec.data.length.toString()));
          }
          sHeader.appendChild(sLeft);
          const chevron = el('span', 'card-section-chevron', '\\u25b8');
          sHeader.appendChild(chevron);
          section.appendChild(sHeader);

          const sBody = el('div', 'card-section-body');
          if (sec.type === 'list' && Array.isArray(sec.data)) {
            const ul = document.createElement('ul');
            sec.data.forEach(item => {
              const li = document.createElement('li');
              setText(li, item);
              ul.appendChild(li);
            });
            sBody.appendChild(ul);
          } else {
            const p = el('p');
            setText(p, sec.data);
            sBody.appendChild(p);
          }
          section.appendChild(sBody);
          body.appendChild(section);

          sHeader.addEventListener('click', () => {
            sBody.classList.toggle('open');
            chevron.classList.toggle('open');
          });
        });
      } else {
        body.appendChild(el('div', 'card-error', op.error || 'Unknown error'));
      }
      card.appendChild(body);
      grid.appendChild(card);
    });
    opinionsPanel.appendChild(grid);

    // --- Reviews panel ---
    const reviewsPanel = document.getElementById('panel-reviews');
    if (DATA.reviews.length > 0) {
      const rGrid = el('div', 'cards-grid');
      DATA.reviews.forEach(rev => {
        const agentCls = AGENT_COLORS[rev.agent] || 'codex';
        const card = el('div', 'agent-card card-accent-' + agentCls);
        const header = el('div', 'card-header');
        const headerLeft = el('div', 'card-header-left');
        headerLeft.appendChild(el('span', 'agent-badge agent-' + agentCls, rev.agent.toUpperCase() + ' review'));
        header.appendChild(headerLeft);
        header.appendChild(el('span', 'card-duration', (rev.duration_ms / 1000).toFixed(1) + 's'));
        card.appendChild(header);
        const body = el('div', 'card-body');
        const p = el('p');
        p.style.fontSize = '0.85rem';
        p.style.whiteSpace = 'pre-wrap';
        setText(p, rev.response);
        body.appendChild(p);
        card.appendChild(body);
        rGrid.appendChild(card);
      });
      reviewsPanel.appendChild(rGrid);
    } else {
      reviewsPanel.appendChild(el('div', 'synthesis-pending', 'No peer reviews. Run with --with-review to enable Stage 2.'));
    }

    // --- Synthesis panel ---
    const synthPanel = document.getElementById('panel-synthesis');
    if (DATA.synthesis) {
      const panel = el('div', 'synthesis-panel');
      panel.appendChild(el('div', 'synthesis-label', 'Chairman Synthesis (' + DATA.synthesis.chairman + ')'));

      const sections = [
        { title: 'Consensus', content: DATA.synthesis.consensus },
        { title: 'Divergence', content: DATA.synthesis.divergence },
        { title: 'Recommendation', content: DATA.synthesis.recommendation },
        { title: 'Confidence', content: DATA.synthesis.confidence },
      ];

      sections.forEach(sec => {
        if (!sec.content) return;
        const s = el('div', 'synthesis-section');
        s.appendChild(el('div', 'synthesis-section-title', sec.title));
        const c = el('div', 'synthesis-section-content');
        setText(c, sec.content);
        s.appendChild(c);
        panel.appendChild(s);
      });
      synthPanel.appendChild(panel);
    } else {
      synthPanel.appendChild(el('div', 'synthesis-pending', 'Synthesis pending. The chairman will produce this after reviewing all opinions.'));
    }

    // --- Revisit diff panel ---
    const revisitPanel = document.getElementById('panel-revisit');
    if (DATA.parentSession && revisitPanel) {
      const grid = el('div', 'revisit-grid');

      // Original column
      const origCol = el('div', 'revisit-col revisit-original');
      const origHeader = el('div', 'revisit-col-header');
      setText(origHeader, 'Original (' + DATA.parentSession.meta.created_at.split('T')[0] + ')');
      origCol.appendChild(origHeader);

      DATA.parentSession.opinions.forEach(op => {
        if (op.status !== 'ok') return;
        const item = el('div', 'revisit-item');
        const label = el('div', 'revisit-item-label');
        setText(label, op.agent + (op.confidence ? ' (' + op.confidence.split('\\n')[0] + ')' : ''));
        item.appendChild(label);
        const val = el('div', 'revisit-item-value');
        setText(val, op.recommendation || op.response.slice(0, 200));
        item.appendChild(val);
        origCol.appendChild(item);
      });

      if (DATA.parentSession.synthesis) {
        const item = el('div', 'revisit-item');
        const label = el('div', 'revisit-item-label');
        label.style.color = 'var(--blue)';
        setText(label, 'Chairman Synthesis');
        item.appendChild(label);
        const val = el('div', 'revisit-item-value');
        setText(val, DATA.parentSession.synthesis.recommendation || '');
        item.appendChild(val);
        origCol.appendChild(item);
      }
      grid.appendChild(origCol);

      // Current column
      const curCol = el('div', 'revisit-col revisit-current');
      const curHeader = el('div', 'revisit-col-header');
      setText(curHeader, 'Revisit (' + DATA.meta.created_at.split('T')[0] + ')');
      curCol.appendChild(curHeader);

      DATA.opinions.forEach(op => {
        if (op.status !== 'ok') return;
        const item = el('div', 'revisit-item');
        const label = el('div', 'revisit-item-label');
        setText(label, op.agent + (op.confidence ? ' (' + op.confidence.split('\\n')[0] + ')' : ''));
        item.appendChild(label);
        const val = el('div', 'revisit-item-value');
        setText(val, op.recommendation || op.response.slice(0, 200));
        item.appendChild(val);
        curCol.appendChild(item);
      });

      if (DATA.synthesis) {
        const item = el('div', 'revisit-item');
        const label = el('div', 'revisit-item-label');
        label.style.color = 'var(--blue)';
        setText(label, 'Chairman Synthesis');
        item.appendChild(label);
        const val = el('div', 'revisit-item-value');
        setText(val, DATA.synthesis.recommendation || '');
        item.appendChild(val);
        curCol.appendChild(item);
      }
      grid.appendChild(curCol);
      revisitPanel.appendChild(grid);
    }

    // --- Outcome banner ---
    if (DATA.meta.outcome) {
      const banner = el('div', 'outcome-banner');
      const dot = el('div', 'outcome-dot');
      banner.appendChild(dot);
      const text = el('div', 'outcome-text');
      setText(text, DATA.meta.outcome.result);
      banner.appendChild(text);
      const date = el('div', 'outcome-date');
      setText(date, DATA.meta.outcome.recorded_at.split('T')[0]);
      banner.appendChild(date);
      // Insert after summary bar
      const summaryBar = document.querySelector('.summary-bar');
      if (summaryBar && summaryBar.parentNode) {
        summaryBar.parentNode.insertBefore(banner, summaryBar.nextSibling);
      }
    }

    // --- Footer ---
    setText(document.getElementById('footerLeft'),
      DATA.meta.created_at.split('T')[0] + ' \\u00b7 council replay ' + DATA.meta.id);
  </script>
</body>
</html>`;

  const viewerPath = resolve(sessionDir, "viewer.html");
  Bun.write(viewerPath, html);
  console.error(`Viewer: ${viewerPath}`);
}
