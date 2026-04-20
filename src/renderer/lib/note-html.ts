import { marked } from 'marked';
import {
  type HighlightColor,
  stripLeadingTitleHeading,
} from '@shared/note-content';

const MARKED_OPTIONS = { gfm: true, breaks: true } as const;
const BLOCK_HIGHLIGHT_RE =
  /:::highlight (yellow|green|blue|pink)\r?\n([\s\S]+?)\r?\n:::/g;
const INLINE_HIGHLIGHT_RE = /==(yellow|green|blue|pink)::([\s\S]+?)==/g;
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);/i;

interface HighlightToken {
  key: string;
  color: HighlightColor;
  content: string;
}

export function renderNoteHtml(markdown: string): string {
  if (!markdown.trim()) return '';

  const blockTokens: HighlightToken[] = [];
  const inlineTokens: HighlightToken[] = [];

  let prepared = escapeHtml(stripLeadingTitleHeading(markdown));
  prepared = prepared.replace(BLOCK_HIGHLIGHT_RE, (_match, color: HighlightColor, content: string) => {
    const key = `VINUBLOCKTOKEN${blockTokens.length}X`;
    blockTokens.push({ key, color, content });
    return `\n\n${key}\n\n`;
  });
  prepared = prepared.replace(INLINE_HIGHLIGHT_RE, (_match, color: HighlightColor, content: string) => {
    const key = `VINUINLINETOKEN${inlineTokens.length}X`;
    inlineTokens.push({ key, color, content });
    return key;
  });

  let html = marked.parse(prepared, MARKED_OPTIONS) as string;

  for (const token of blockTokens) {
    const rendered = renderHighlightBlock(token);
    html = html.replace(new RegExp(`<p>${escapeRegExp(token.key)}</p>`, 'g'), rendered);
    html = html.replace(new RegExp(escapeRegExp(token.key), 'g'), rendered);
  }

  for (const token of inlineTokens) {
    html = html.replace(new RegExp(escapeRegExp(token.key), 'g'), renderHighlightInline(token));
  }

  return sanitizeRenderedHtml(html);
}

function renderHighlightInline(token: HighlightToken): string {
  const content = marked.parseInline(escapeHtml(token.content), MARKED_OPTIONS) as string;
  return `<mark class="note-highlight note-highlight-${token.color}">${content}</mark>`;
}

function renderHighlightBlock(token: HighlightToken): string {
  const content = marked.parse(escapeHtml(token.content), MARKED_OPTIONS) as string;
  return `<div class="note-highlight-block note-highlight-${token.color}">${content}</div>`;
}

function sanitizeRenderedHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div data-root="true">${html}</div>`, 'text/html');
  const root = doc.body.querySelector('[data-root="true"]');
  if (!root) return '';

  root
    .querySelectorAll('script, style, iframe, object, embed, link, meta')
    .forEach((node) => node.remove());

  root.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href') {
        const safeHref = sanitizeUrl(attr.value, 'link');
        if (safeHref) node.setAttribute(attr.name, safeHref);
        else node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'src') {
        const safeSrc = sanitizeUrl(attr.value, 'image');
        if (safeSrc) node.setAttribute(attr.name, safeSrc);
        else node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'class') {
        const safeClass = attr.value
          .split(/\s+/)
          .filter((value) => value.startsWith('note-highlight'))
          .join(' ');
        if (safeClass) node.setAttribute('class', safeClass);
        else node.removeAttribute('class');
        continue;
      }
      if (!['alt', 'title'].includes(name)) {
        node.removeAttribute(attr.name);
      }
    }

    if (node instanceof HTMLAnchorElement) {
      node.target = '_blank';
      node.rel = 'noreferrer';
    }
    if (node instanceof HTMLImageElement) {
      node.loading = 'lazy';
      node.classList.add('note-image');
    }
  });

  return root.innerHTML;
}

function sanitizeUrl(raw: string, kind: 'link' | 'image'): string | null {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (!value) return null;
  if (value.startsWith('#')) return value;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return value;
  if (kind === 'link' && lower.startsWith('mailto:')) return value;
  if (kind === 'image' && SAFE_DATA_IMAGE_RE.test(value)) return value;
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
