export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

const COLOR_PATTERN = HIGHLIGHT_COLORS.join('|');

const BLOCK_HIGHLIGHT_RE = new RegExp(
  `:::highlight (${COLOR_PATTERN})\\r?\\n([\\s\\S]+?)\\r?\\n:::`,
  'g',
);
const INLINE_HIGHLIGHT_RE = new RegExp(`==(${COLOR_PATTERN})::([\\s\\S]+?)==`, 'g');
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function isHighlightColor(value: string): value is HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

export function stripNoteMarkupForSearch(markdown: string): string {
  return markdown
    .replace(BLOCK_HIGHLIGHT_RE, (_match, _color, content: string) => `\n${content}\n`)
    .replace(INLINE_HIGHLIGHT_RE, (_match, _color, content: string) => content)
    .replace(IMAGE_RE, (_match, alt: string) => `${alt} `)
    .replace(LINK_RE, (_match, text: string) => text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripLeadingTitleHeading(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]+(?:\r?\n)?(?:\r?\n)?/, '').trimStart();
}
