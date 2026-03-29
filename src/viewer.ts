import { resolve } from "path";
import type { AgentResult } from "./adapters";

interface SessionMeta {
  id: string;
  question: string;
  project: string;
  chairman: string;
  members: string[];
  mode: string;
  created_at: string;
  context_files: string[];
}

function escapeJsonForScript(data: any): string {
  // Escape </script> and <!-- to prevent XSS when embedding JSON in <script> tags
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

export function generateViewer(
  sessionDir: string,
  meta: SessionMeta,
  opinions: AgentResult[]
): void {
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
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Council: ${escapeHtml(meta.question.slice(0, 60))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 960px; margin: 0 auto; line-height: 1.6; }
    h1 { color: #f0f6fc; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 2rem; border-bottom: 1px solid #21262d; padding-bottom: 1rem; }
    .meta span { margin-right: 1.5rem; }
    .question { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 1rem; margin-bottom: 2rem; font-size: 1.1rem; }
    .opinion { background: #161b22; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 1rem; overflow: hidden; }
    .opinion-header { padding: 0.75rem 1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; }
    .opinion-header:hover { background: #1c2128; }
    .agent-name { font-weight: 600; color: #f0f6fc; }
    .status-ok { color: #3fb950; }
    .status-error, .status-timeout { color: #f85149; }
    .confidence { font-size: 0.8rem; padding: 2px 8px; border-radius: 12px; }
    .confidence-high { background: #1a3a2a; color: #3fb950; }
    .confidence-medium { background: #3a2a1a; color: #d29922; }
    .confidence-low { background: #3a1a1a; color: #f85149; }
    .opinion-body { padding: 0 1rem 1rem; display: none; }
    .opinion-body.open { display: block; }
    .section { margin-top: 1rem; }
    .section-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 0.25rem; }
    .section-content { white-space: pre-wrap; }
    .duration { color: #8b949e; font-size: 0.8rem; }
    .toggle { color: #8b949e; transition: transform 0.2s; }
    .toggle.open { transform: rotate(90deg); }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.25rem; }
  </style>
</head>
<body>
  <h1>Agent Council</h1>
  <div class="meta">
    <span>Session: ${meta.id}</span>
    <span>Mode: ${meta.mode}</span>
    <span>Chairman: ${meta.chairman}</span>
    <span>${meta.created_at.split("T")[0]}</span>
  </div>
  <div class="question" id="question"></div>
  <div id="opinions"></div>
  <script>
    const DATA = ${escapeJsonForScript(viewerData)};

    // Safely set text content (no innerHTML, XSS-safe)
    function setText(el, text) { el.textContent = text; }
    function createEl(tag, className) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      return el;
    }

    // Render question
    setText(document.getElementById('question'), DATA.meta.question);

    // Render opinions
    const container = document.getElementById('opinions');
    DATA.opinions.forEach((op, i) => {
      const card = createEl('div', 'opinion');

      // Header
      const header = createEl('div', 'opinion-header');
      const left = createEl('div');
      const agentSpan = createEl('span', 'agent-name');
      setText(agentSpan, op.agent.toUpperCase());
      left.appendChild(agentSpan);

      const statusSpan = createEl('span', 'status-' + op.status);
      setText(statusSpan, ' ' + op.status);
      left.appendChild(statusSpan);

      if (op.confidence) {
        const level = op.confidence.toLowerCase().split(/[^a-z]/)[0];
        const conf = createEl('span', 'confidence confidence-' + level);
        setText(conf, op.confidence.split('\\n')[0]);
        left.appendChild(document.createTextNode(' '));
        left.appendChild(conf);
      }

      const right = createEl('div');
      const dur = createEl('span', 'duration');
      setText(dur, (op.duration_ms / 1000).toFixed(1) + 's');
      right.appendChild(dur);
      const toggle = createEl('span', 'toggle');
      setText(toggle, ' ▸');
      right.appendChild(toggle);

      header.appendChild(left);
      header.appendChild(right);
      card.appendChild(header);

      // Body
      const body = createEl('div', 'opinion-body');
      if (op.status === 'ok') {
        if (op.structured) {
          if (op.recommendation) {
            const sec = createEl('div', 'section');
            const title = createEl('div', 'section-title');
            setText(title, 'Recommendation');
            sec.appendChild(title);
            const content = createEl('div', 'section-content');
            setText(content, op.recommendation);
            sec.appendChild(content);
            body.appendChild(sec);
          }
          if (op.reasoning && op.reasoning.length) {
            const sec = createEl('div', 'section');
            const title = createEl('div', 'section-title');
            setText(title, 'Reasoning');
            sec.appendChild(title);
            const ul = document.createElement('ul');
            op.reasoning.forEach(r => {
              const li = document.createElement('li');
              setText(li, r);
              ul.appendChild(li);
            });
            sec.appendChild(ul);
            body.appendChild(sec);
          }
          if (op.tradeoffs) {
            const sec = createEl('div', 'section');
            const title = createEl('div', 'section-title');
            setText(title, 'Trade-offs');
            sec.appendChild(title);
            const content = createEl('div', 'section-content');
            setText(content, op.tradeoffs);
            sec.appendChild(content);
            body.appendChild(sec);
          }
          if (op.dissent_points) {
            const sec = createEl('div', 'section');
            const title = createEl('div', 'section-title');
            setText(title, 'Dissent Points');
            sec.appendChild(title);
            const content = createEl('div', 'section-content');
            setText(content, op.dissent_points);
            sec.appendChild(content);
            body.appendChild(sec);
          }
        } else {
          const content = createEl('div', 'section-content');
          setText(content, op.response);
          body.appendChild(content);
        }
      } else {
        const err = createEl('div', 'section-content status-error');
        setText(err, op.error || 'Unknown error');
        body.appendChild(err);
      }
      card.appendChild(body);
      container.appendChild(card);

      // Toggle expand/collapse
      header.addEventListener('click', () => {
        body.classList.toggle('open');
        toggle.classList.toggle('open');
      });

      // Auto-expand first opinion
      if (i === 0) {
        body.classList.add('open');
        toggle.classList.add('open');
      }
    });
  </script>
</body>
</html>`;

  const viewerPath = resolve(sessionDir, "viewer.html");
  Bun.write(viewerPath, html);
  console.error(`Viewer: ${viewerPath}`);
}
