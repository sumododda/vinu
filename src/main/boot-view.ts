export type BootViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

/**
 * Inline SVG mark identical to the in-app Logo component.  Self-contained
 * so it renders in the boot `data:` URL without external assets.
 */
const LOGO_MARK_SVG = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <mask id="bubble-knockout">
      <rect x="34" y="8" width="20" height="13" rx="4" fill="white" />
      <circle cx="39" cy="14.5" r="1.3" fill="black" />
      <circle cx="44" cy="14.5" r="1.3" fill="black" />
      <circle cx="49" cy="14.5" r="1.3" fill="black" />
    </mask>
  </defs>
  <path d="M16 23 L32 55" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
  <path d="M44 21 L32 55" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
  <rect x="11" y="7" width="10" height="17" rx="5" fill="currentColor" />
  <rect x="34" y="8" width="20" height="13" rx="4" fill="currentColor" mask="url(#bubble-knockout)" />
</svg>`;

export function renderBootHtml(state: BootViewState): string {
  const title = state.kind === 'loading' ? 'Starting vinu' : 'vinu could not start';
  const body =
    state.kind === 'loading'
      ? `<p class="subtitle">Warming up local services<span class="dots"><span></span><span></span><span></span></span></p>`
      : `<div class="error-card" role="alert">
           <p class="error-title">Something went wrong while starting up</p>
           <pre class="error-body">${escapeHtml(state.message)}</pre>
         </div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;

        --bg: #F7F4EB;
        --ink: #17161C;
        --ink-2: #4A4853;
        --ink-3: #767282;
        --accent: #B4472A;
        --surface: #FFFFFF;
        --border: #E5E1D3;
        --danger: #B1332D;
        --shadow: 0 1px 2px rgba(17,16,28,0.05), 0 6px 16px -6px rgba(17,16,28,0.1);

        --font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text',
                   'Segoe UI Variable', 'Inter', system-ui, sans-serif;
        --font-serif: 'New York', 'Iowan Old Style', 'Charter', Georgia, serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #131219;
          --ink: #F5F3EE;
          --ink-2: #C2BEB3;
          --ink-3: #8E8A80;
          --accent: #E06D48;
          --surface: #1B1A22;
          --border: #2A2833;
          --danger: #E0685C;
          --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 8px 20px -8px rgba(0,0,0,0.45);
        }
      }

      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        background: var(--bg);
        color: var(--ink);
        font-family: var(--font-ui);
        -webkit-font-smoothing: antialiased;
        display: grid;
        place-items: center;
        user-select: none;
      }

      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        padding: 24px;
        max-width: 480px;
        text-align: center;
      }

      .lockup {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--accent);
        animation: breathe 2.6s ease-in-out infinite;
      }
      .lockup svg { width: 44px; height: 44px; }
      .wordmark {
        font-family: var(--font-serif);
        font-style: italic;
        font-weight: 500;
        font-size: 40px;
        letter-spacing: -0.02em;
        color: var(--ink);
        line-height: 1;
      }
      @keyframes breathe {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.78; transform: scale(0.985); }
      }

      .subtitle {
        margin: 0;
        color: var(--ink-3);
        font-size: 13.5px;
        letter-spacing: 0.002em;
      }

      .dots {
        display: inline-flex;
        gap: 3px;
        margin-left: 4px;
        transform: translateY(-1px);
      }
      .dots span {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: currentColor;
        animation: blink 1.4s ease-in-out infinite;
      }
      .dots span:nth-child(2) { animation-delay: 0.2s; }
      .dots span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes blink {
        0%, 80%, 100% { opacity: 0.2; }
        40% { opacity: 1; }
      }

      .error-card {
        margin-top: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 18px 20px;
        box-shadow: var(--shadow);
        text-align: left;
        width: 100%;
      }
      .error-title {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--danger);
      }
      .error-body {
        margin: 0;
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
        color: var(--ink-2);
        white-space: pre-wrap;
        word-break: break-word;
      }

      @media (prefers-reduced-motion: reduce) {
        .lockup { animation: none; }
        .dots span { animation: none; opacity: 0.6; }
      }
    </style>
  </head>
  <body>
    <main>
      <span class="lockup" aria-label="vinu">
        ${LOGO_MARK_SVG}
        <span class="wordmark">vinu</span>
      </span>
      ${body}
    </main>
  </body>
</html>`;
}

export function formatBootError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
