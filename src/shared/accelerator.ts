// Electron accelerator format helpers. Shared so the renderer can display /
// capture without pulling in electron.
//
// Electron accelerators look like "CommandOrControl+Shift+N".  The left side
// is a chain of modifiers joined by `+`, and the last token is the key.

const MODIFIER_SET = new Set([
  'CommandOrControl',
  'CmdOrCtrl',
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

export interface AcceleratorParts {
  modifiers: string[]; // canonicalised: "CommandOrControl" | "Alt" | "Shift" | "Control"
  key: string; // e.g. "N", "F1", "Enter", "Space"
}

export function parseAccelerator(accel: string): AcceleratorParts | null {
  if (!accel) return null;
  const tokens = accel.split('+').map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null; // require at least one modifier + key

  const modifiers: string[] = [];
  let key: string | null = null;

  for (const t of tokens) {
    if (MODIFIER_SET.has(t)) {
      modifiers.push(canonModifier(t));
    } else {
      if (key) return null; // more than one non-modifier token
      key = t;
    }
  }
  if (!key || modifiers.length === 0) return null;
  return { modifiers: dedupe(modifiers), key };
}

function canonModifier(m: string): string {
  if (m === 'CmdOrCtrl' || m === 'CommandOrControl') return 'CommandOrControl';
  if (m === 'Command' || m === 'Cmd' || m === 'Meta' || m === 'Super') return 'Meta';
  if (m === 'Control' || m === 'Ctrl') return 'Control';
  if (m === 'Option') return 'Alt';
  return m; // Alt, Shift, AltGr
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** Build an accelerator string from a KeyboardEvent. Returns null if the
 * event doesn't form a usable shortcut (e.g. modifier-only, or a bare key). */
export function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const modifiers: string[] = [];
  // Map Cmd (Mac) and Ctrl to the portable "CommandOrControl" token.
  if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;

  const key = normalizeKey(e.key, e.code);
  if (!key) return null;
  return [...modifiers, key].join('+');
}

function normalizeKey(key: string, code: string): string | null {
  if (!key) return null;
  // Ignore bare modifier keys
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return null;

  // Letters: always render uppercase
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  // Digits
  if (/^[0-9]$/.test(key)) return key;

  // Function keys
  if (/^F(\d{1,2})$/.test(key)) return key;

  // Named keys → Electron accelerator names
  const named: Record<string, string> = {
    ' ': 'Space',
    Enter: 'Return',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    '+': 'Plus',
    '-': '-',
    '=': '=',
    ',': ',',
    '.': '.',
    '/': '/',
    ';': ';',
    "'": "'",
    '[': '[',
    ']': ']',
    '\\': '\\',
    '`': '`',
  };
  if (named[key]) return named[key];

  // Fall back to physical code for weird inputs (e.g. dead-keys).
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);

  return null;
}

/** Minimum-viable validity test without round-tripping to electron. */
export function isValidAccelerator(accel: string): boolean {
  return parseAccelerator(accel) !== null;
}
