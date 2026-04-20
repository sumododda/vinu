import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HotkeyManager } from './hotkey';

function fakeShortcut() {
  const registry = new Map<string, () => void>();
  return {
    registry,
    api: {
      register: vi.fn((accel: string, cb: () => void) => {
        registry.set(accel, cb);
        return true;
      }),
      unregister: vi.fn((accel: string) => registry.delete(accel)),
      unregisterAll: vi.fn(() => registry.clear()),
      isRegistered: vi.fn((accel: string) => registry.has(accel)),
    },
  };
}

describe('HotkeyManager', () => {
  let onPress: () => void;
  beforeEach(() => { onPress = vi.fn(); });

  it('registers when enabled', () => {
    const f = fakeShortcut();
    const m = new HotkeyManager({ globalShortcut: f.api as any, onPress: () => onPress() });
    const ok = m.apply({ enabled: true, accelerator: 'CommandOrControl+Shift+N' });
    expect(ok).toBe(true);
    expect(f.registry.has('CommandOrControl+Shift+N')).toBe(true);
  });

  it('unregisters previous when accelerator changes', () => {
    const f = fakeShortcut();
    const m = new HotkeyManager({ globalShortcut: f.api as any, onPress: () => onPress() });
    m.apply({ enabled: true, accelerator: 'CommandOrControl+Shift+N' });
    m.apply({ enabled: true, accelerator: 'CommandOrControl+Alt+R' });
    expect(f.registry.has('CommandOrControl+Shift+N')).toBe(false);
    expect(f.registry.has('CommandOrControl+Alt+R')).toBe(true);
  });

  it('clears all when disabled', () => {
    const f = fakeShortcut();
    const m = new HotkeyManager({ globalShortcut: f.api as any, onPress: () => onPress() });
    m.apply({ enabled: true, accelerator: 'CommandOrControl+Shift+N' });
    m.apply({ enabled: false, accelerator: 'CommandOrControl+Shift+N' });
    expect(f.registry.size).toBe(0);
  });

  it('returns false on registration conflict', () => {
    const f = fakeShortcut();
    f.api.register = vi.fn(() => false) as any;
    const m = new HotkeyManager({ globalShortcut: f.api as any, onPress: () => onPress() });
    expect(m.apply({ enabled: true, accelerator: 'CommandOrControl+Shift+N' })).toBe(false);
  });
});
