export type BootViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

export function renderBootHtml(state: BootViewState): string {
  const title = state.kind === 'loading' ? 'Starting Vinu' : 'Vinu could not start';
  const body =
    state.kind === 'loading'
      ? '<p class="message">Preparing local services. This can take a moment on first launch.</p>'
      : `<p class="message error">${escapeHtml(state.message)}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #111827, #0f172a);
        color: #e5e7eb;
      }
      main {
        width: min(560px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.9);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.5rem;
      }
      .message {
        margin: 0;
        line-height: 1.5;
        color: #cbd5e1;
        white-space: pre-wrap;
      }
      .error {
        color: #fecaca;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
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
