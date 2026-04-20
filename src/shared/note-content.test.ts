import { describe, expect, it } from 'vitest';
import {
  hydrateInlineImages,
  INLINE_IMAGE_TOKEN_PREFIX,
  normalizeInlineImagesForEditing,
} from './note-content';

describe('inline image editing helpers', () => {
  it('replaces inline data images with compact editor tokens and hydrates them back', () => {
    const raw =
      '# Note\n\n![chart](data:image/png;base64,AAAA)\n\nParagraph\n\n![photo](data:image/jpeg;base64,BBBB)';

    const editable = normalizeInlineImagesForEditing(raw);

    expect(editable.markdown).toContain(INLINE_IMAGE_TOKEN_PREFIX);
    expect(editable.markdown).not.toContain('data:image/png;base64,AAAA');
    expect(editable.markdown).not.toContain('data:image/jpeg;base64,BBBB');
    expect(Object.keys(editable.inlineImages)).toHaveLength(2);

    const hydrated = hydrateInlineImages(editable.markdown, editable.inlineImages);
    expect(hydrated).toBe(raw);
  });

  it('preserves existing image tokens and prunes removed ones', () => {
    const inlineImages = {
      'inline-image:keep': 'data:image/png;base64,AAAA',
      'inline-image:drop': 'data:image/png;base64,BBBB',
    };

    const editable = normalizeInlineImagesForEditing(
      '![keep](inline-image:keep)\n\nPlain text',
      inlineImages,
    );

    expect(editable.markdown).toContain('inline-image:keep');
    expect(editable.inlineImages).toEqual({
      'inline-image:keep': 'data:image/png;base64,AAAA',
    });
  });
});
