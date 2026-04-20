import { parseAccelerator } from '@shared/accelerator';

export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export function modifierLabel(m: string): string {
  if (IS_MAC) {
    if (m === 'CommandOrControl' || m === 'Meta') return '⌘';
    if (m === 'Alt') return '⌥';
    if (m === 'Shift') return '⇧';
    if (m === 'Control') return '⌃';
  } else {
    if (m === 'CommandOrControl' || m === 'Meta') return 'Ctrl';
    if (m === 'Alt') return 'Alt';
    if (m === 'Shift') return 'Shift';
    if (m === 'Control') return 'Ctrl';
  }
  return m;
}

export function keyLabel(k: string): string {
  const map: Record<string, string> = {
    Return: '↵',
    Space: '␣',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    Backspace: '⌫',
    Delete: '⌦',
    Tab: '⇥',
    Esc: '⎋',
    Plus: '+',
  };
  return map[k] ?? k;
}

/** Turn an accelerator string into an ordered list of badge labels. */
export function acceleratorBadges(accel: string): string[] | null {
  const parts = parseAccelerator(accel);
  if (!parts) return null;
  return [...parts.modifiers.map(modifierLabel), keyLabel(parts.key)];
}
