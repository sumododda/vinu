// Runtime-safe helper shared between the main process and the renderer.
// No node-only imports — this file is bundled into the renderer as well.

/**
 * Extract a human-readable title from a markdown document.
 *
 * Looks for the first top-level ATX heading (`# Heading`). If none exists, or
 * the heading text is empty after trimming, returns `fallback`.
 */
export function extractTitle(markdown: string, fallback = 'Untitled'): string {
  if (typeof markdown !== 'string' || markdown.length === 0) return fallback;
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : fallback;
}
