import { describe, it, expect } from 'vitest';
import {
  keyEventToAccelerator,
  parseAccelerator,
  isValidAccelerator,
} from './accelerator';

function ev(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe('parseAccelerator', () => {
  it('parses a canonical CommandOrControl+Shift+N', () => {
    expect(parseAccelerator('CommandOrControl+Shift+N')).toEqual({
      modifiers: ['CommandOrControl', 'Shift'],
      key: 'N',
    });
  });

  it('canonicalises Cmd / CmdOrCtrl / Option aliases', () => {
    expect(parseAccelerator('CmdOrCtrl+Option+Space')).toEqual({
      modifiers: ['CommandOrControl', 'Alt'],
      key: 'Space',
    });
  });

  it('rejects modifier-only combos', () => {
    expect(parseAccelerator('Shift+Control')).toBeNull();
  });

  it('rejects bare keys with no modifier', () => {
    expect(parseAccelerator('N')).toBeNull();
    expect(parseAccelerator('')).toBeNull();
  });

  it('rejects multiple non-modifier tokens', () => {
    expect(parseAccelerator('CommandOrControl+N+M')).toBeNull();
  });
});

describe('keyEventToAccelerator', () => {
  it('maps metaKey + shift + N → CommandOrControl+Shift+N', () => {
    expect(
      keyEventToAccelerator(ev({ key: 'n', metaKey: true, shiftKey: true })),
    ).toBe('CommandOrControl+Shift+N');
  });

  it('uppercases letters regardless of shift state', () => {
    expect(
      keyEventToAccelerator(ev({ key: 'A', ctrlKey: true })),
    ).toBe('CommandOrControl+A');
  });

  it('maps space, arrows, enter', () => {
    expect(keyEventToAccelerator(ev({ key: ' ', altKey: true }))).toBe('Alt+Space');
    expect(keyEventToAccelerator(ev({ key: 'ArrowUp', ctrlKey: true }))).toBe(
      'CommandOrControl+Up',
    );
    expect(keyEventToAccelerator(ev({ key: 'Enter', metaKey: true }))).toBe(
      'CommandOrControl+Return',
    );
  });

  it('returns null for modifier-only events', () => {
    expect(keyEventToAccelerator(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(keyEventToAccelerator(ev({ key: 'n' }))).toBeNull(); // no modifier
  });

  it('falls back to event.code when event.key is unrecognised', () => {
    expect(
      keyEventToAccelerator(ev({ key: 'Dead', code: 'KeyQ', metaKey: true })),
    ).toBe('CommandOrControl+Q');
  });
});

describe('isValidAccelerator', () => {
  it('accepts good values and rejects bad ones', () => {
    expect(isValidAccelerator('CommandOrControl+Shift+N')).toBe(true);
    expect(isValidAccelerator('N')).toBe(false);
    expect(isValidAccelerator('')).toBe(false);
  });
});
