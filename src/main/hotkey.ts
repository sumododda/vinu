import type { globalShortcut as GlobalShortcut } from 'electron';

type GlobalShortcutLike = Pick<typeof GlobalShortcut, 'register' | 'unregister' | 'unregisterAll' | 'isRegistered'>;

export interface HotkeyConfig {
  enabled: boolean;
  accelerator: string;
}

export interface HotkeyDeps {
  globalShortcut: GlobalShortcutLike;
  onPress: () => void;
}

export class HotkeyManager {
  private current: string | null = null;
  constructor(private readonly deps: HotkeyDeps) {}

  apply(cfg: HotkeyConfig): boolean {
    if (this.current && this.current !== cfg.accelerator) {
      this.deps.globalShortcut.unregister(this.current);
      this.current = null;
    }
    if (!cfg.enabled) {
      this.deps.globalShortcut.unregisterAll();
      this.current = null;
      return true;
    }
    if (this.current === cfg.accelerator) return true;
    const ok = this.deps.globalShortcut.register(cfg.accelerator, this.deps.onPress);
    if (ok) this.current = cfg.accelerator;
    return ok;
  }
}
