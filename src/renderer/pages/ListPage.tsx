import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LogoLockup } from '../components/Logo';
import { acceleratorBadges } from '../lib/accelerator-display';

type Shortcut =
  | { status: 'loading' }
  | { status: 'ready'; badges: string[] }
  | { status: 'disabled' }
  | { status: 'unset' };

function useShortcut(): Shortcut {
  const [s, setS] = useState<Shortcut>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api.settings
        .get()
        .then((settings) => {
          if (cancelled) return;
          if (!settings.hotkeyEnabled) return setS({ status: 'disabled' });
          const badges = acceleratorBadges(settings.hotkeyAccelerator);
          if (!badges) return setS({ status: 'unset' });
          setS({ status: 'ready', badges });
        })
        .catch(() => {
          if (cancelled) return;
          setS({ status: 'unset' });
        });
    };

    load();
    // The page remounts on route change, but also listen for any settings
    // writes that happen while we're visible (future-proof for live updates).
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  return s;
}

export function ListPage() {
  const shortcut = useShortcut();

  return (
    <div className="empty-hero">
      <LogoLockup size={56} className="hero-lockup" />
      <h1>Think out loud.</h1>
      <p>
        Vinu records your voice, transcribes it on your machine, and turns the thought
        into clean notes with your favorite LLM.
      </p>

      {shortcut.status === 'ready' && (
        <div className="shortcuts">
          <span>Press</span>
          {shortcut.badges.map((b, i) => (
            <kbd key={i}>{b}</kbd>
          ))}
          <span>to record</span>
        </div>
      )}
      {shortcut.status === 'disabled' && (
        <div className="shortcuts">
          <span>
            Hit the record button in the sidebar, or enable the global hotkey in{' '}
            <a href="#/settings">settings</a>.
          </span>
        </div>
      )}
      {shortcut.status === 'unset' && (
        <div className="shortcuts">
          <span>
            Set a shortcut in <a href="#/settings">settings</a> to record without leaving
            your current app.
          </span>
        </div>
      )}
    </div>
  );
}
