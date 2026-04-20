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
      '![chart](data:image/png;base64,AAAA)\n\n![svg](data:image/svg+xml;base64,PHN2Zz4=)\n\n[bad](javascript:alert(1))\n\n[file](file:///tmp/x.png)\n\n[good](https://example.com)',
    );

    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('data:image/svg+xml');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('file:///tmp/x.png');
    expect(html).toContain('https://example.com');
  });

  it('escapes raw html inside highlight syntax', () => {
    const html = renderNoteHtml('==yellow::<img src="https://evil.test/x.png" onerror="boom()">==');

    expect(html).not.toContain('<img');
    expect(html).toContain('note-highlight-yellow');
    expect(html).toContain('evil.test/x.png');
  });
});
