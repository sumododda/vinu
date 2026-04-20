// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderNoteHtml } from './note-html';

describe('renderNoteHtml', () => {
  it('renders custom inline and block highlights', () => {
    const html = renderNoteHtml(
      '# Title\n\n==yellow::inline==\n\n:::highlight blue\nline one\nline two\n:::',
    );

    expect(html).toContain('note-highlight-yellow');
    expect(html).toContain('note-highlight-block');
    expect(html).toContain('line one');
  });

  it('keeps inline data images but strips unsafe links', () => {
    const html = renderNoteHtml(
      '![chart](data:image/png;base64,AAAA)\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)',
    );

    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('https://example.com');
  });
});
