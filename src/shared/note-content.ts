export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export const INLINE_IMAGE_TOKEN_PREFIX = 'inline-image:';

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

const COLOR_PATTERN = HIGHLIGHT_COLORS.join('|');
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/i;

const BLOCK_HIGHLIGHT_RE = new RegExp(
  `:::highlight (${COLOR_PATTERN})\\r?\\n([\\s\\S]+?)\\r?\\n:::`,
  'g',
);
const INLINE_HIGHLIGHT_RE = new RegExp(`==(${COLOR_PATTERN})::([\\s\\S]+?)==`, 'g');
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const INLINE_IMAGE_TOKEN_RE = /!\[([^\]]*)\]\((inline-image:[^)]+)\)/g;

export interface InlineImageEditState {
  markdown: string;
  inlineImages: Record<string, string>;
}

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

export function normalizeInlineImagesForEditing(
  markdown: string,
  existingInlineImages: Record<string, string> = {},
): InlineImageEditState {
  const inlineImages: Record<string, string> = {};

  let normalized = markdown.replace(INLINE_IMAGE_TOKEN_RE, (match, _alt: string, token: string) => {
    const dataUrl = existingInlineImages[token];
    if (dataUrl) inlineImages[token] = dataUrl;
    return match;
  });

  normalized = normalized.replace(IMAGE_RE, (match, alt: string, url: string) => {
    if (!SAFE_DATA_IMAGE_RE.test(url)) return match;
    const token = createInlineImageToken(inlineImages, existingInlineImages);
    inlineImages[token] = url;
    return `![${alt}](${token})`;
  });

  return { markdown: normalized, inlineImages };
}

export function hydrateInlineImages(
  markdown: string,
  inlineImages: Record<string, string>,
): string {
  return markdown.replace(
    INLINE_IMAGE_TOKEN_RE,
    (match, alt: string, token: string) => {
      const dataUrl = inlineImages[token];
      if (!dataUrl) return match;
      return `![${alt}](${dataUrl})`;
    },
  );
}

function createInlineImageToken(
  inlineImages: Record<string, string>,
  existingInlineImages: Record<string, string>,
): string {
  let token = '';
  do {
    token = `${INLINE_IMAGE_TOKEN_PREFIX}${randomId()}`;
  } while (token in inlineImages || token in existingInlineImages);
  return token;
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
