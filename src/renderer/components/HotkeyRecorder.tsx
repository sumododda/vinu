import { useEffect, useState } from 'react';
import { keyEventToAccelerator } from '@shared/accelerator';
import { acceleratorBadges } from '../lib/accelerator-display';

interface HotkeyRecorderProps {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}

function AcceleratorBadges({ accel }: { accel: string }) {
  const badges = acceleratorBadges(accel);
  if (!badges) return <span className="hotkey-empty">— none —</span>;
  return (
    <span className="hotkey-badges">
      {badges.map((label, i) => (
        <kbd key={i}>{label}</kbd>
      ))}
    </span>
  );
}

export function HotkeyRecorder({ value, disabled, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startRecording() {
    if (disabled) return;
    setError(null);
    setRecording(true);
  }

  function cancelRecording() {
    setRecording(false);
    setError(null);
  }

  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      // Escape cancels.
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        cancelRecording();
        return;
      }
      // Ignore bare modifier presses — wait for the user to commit a key.
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();
      const accel = keyEventToAccelerator(e);
      if (!accel) {
        setError('Include at least one modifier (⌘, ⌥, ⌃, or ⇧) plus a key.');
        return;
      }
      onChange(accel);
      setRecording(false);
      setError(null);
    };

    // Capture-phase so we beat editor / menu handlers.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, onChange]);

  return (
    <div
      className={`hotkey-recorder ${recording ? 'recording' : ''} ${
        disabled ? 'disabled' : ''
      }`}
    >
      <div className="hotkey-display">
        {recording ? (
          <span className="hotkey-prompt">
            Press a key combination<span className="hotkey-caret">…</span>
          </span>
        ) : (
          <AcceleratorBadges accel={value} />
        )}
      </div>
      {recording ? (
        <button type="button" className="ghost" onClick={cancelRecording}>
          Cancel
        </button>
      ) : (
        <button
          type="button"
          className="ghost"
          onClick={startRecording}
          disabled={disabled}
        >
          Change
        </button>
      )}
      {error && <div className="hotkey-error">{error}</div>}
    </div>
  );
}
