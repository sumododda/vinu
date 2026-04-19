import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

describe('prompts', () => {
  it('SYSTEM_PROMPT mentions a single H1 title and bullets', () => {
    expect(SYSTEM_PROMPT).toMatch(/single H1/);
    expect(SYSTEM_PROMPT).toMatch(/bullets/);
  });

  it('buildUserPrompt embeds the transcript verbatim inside a fenced block', () => {
    const out = buildUserPrompt('hello world');
    expect(out).toContain('hello world');
    expect(out).toMatch(/```transcript[\s\S]+```/);
  });
});
