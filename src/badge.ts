/**
 * The on-page status badge.
 *
 * Split out of `userscript.ts` (Phase 5 Task 5.7b). It is the only part of the userscript that touches the
 * DOM directly, so it is the part worth being able to read on its own: everything else delegates
 * to {@link BootstrappedClient}.
 */

/** The element id and shadow host. Prefixed so it can never collide with the game's own markup. */
const HOST_ID = '__mgjs_status_host';

export interface BadgeHandle {
  setStatus(text: string, tone: 'starting' | 'attached' | 'ready' | 'error'): void;
  setDetail(lines: string[]): void;
  destroy(): void;
}

/**
 * Create the status badge, isolated in a shadow root.
 *
 * Uses `attachShadow` rather than a plain element because the game ships a large global stylesheet and
 * a badge that inherits from it would be at best ugly and at worst invisible. `all: initial` on the
 * host adds a second layer of insulation.
 *
 * Returns `null` when the document is not in a state where a badge can be attached. Callers must treat
 * a missing badge as a non-fatal degradation, because the mod still works without one.
 */
export function createBadge(doc: Document): BadgeHandle | null {
  const host = doc.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    right: '10px',
    bottom: '10px',
    zIndex: '2147483647',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `
    .badge {
      font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #e8f5e9;
      background: rgba(12, 24, 16, 0.86);
      border: 1px solid rgba(120, 220, 150, 0.45);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
      max-width: 320px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    }
    .badge[data-tone="starting"] { border-color: rgba(220, 200, 120, 0.5); color: #fff8e1; }
    .badge[data-tone="ready"]    { border-color: rgba(120, 220, 150, 0.75); color: #e8f5e9; }
    .badge[data-tone="error"]    { border-color: rgba(230, 120, 120, 0.7); color: #ffebee; }
    .dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px;
           background:#ffd54f; vertical-align:middle; }
    .badge[data-tone="ready"] .dot { background:#66bb6a; }
    .badge[data-tone="error"] .dot { background:#ef5350; }
    .detail { display:none; margin-top:6px; padding-top:6px; white-space:pre-wrap;
              border-top:1px solid rgba(255,255,255,0.15); opacity:0.85; }
    .badge[data-open="true"] .detail { display:block; }
    .hint { opacity:0.55; margin-left:6px; }
  `;

  const badge = doc.createElement('div');
  badge.className = 'badge';
  badge.dataset.tone = 'starting';

  const line = doc.createElement('div');
  const dot = doc.createElement('span');
  dot.className = 'dot';
  const label = doc.createElement('span');
  label.textContent = 'magicgarden.js';
  const hint = doc.createElement('span');
  hint.className = 'hint';
  hint.textContent = '(click)';
  line.append(dot, label, hint);

  const detail = doc.createElement('div');
  detail.className = 'detail';

  badge.append(line, detail);
  shadow.append(style, badge);
  badge.addEventListener('click', () => {
    badge.dataset.open = badge.dataset.open === 'true' ? 'false' : 'true';
  });

  (doc.body ?? doc.documentElement).appendChild(host);

  return {
    setStatus(text, tone) {
      label.textContent = text;
      badge.dataset.tone = tone;
    },
    setDetail(lines) {
      detail.textContent = lines.join('\n');
    },
    destroy() {
      host.remove();
    },
  };
}
