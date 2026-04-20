import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface RecorderProps {
  onCreated: (id: string) => void;
}

export function Recorder({ onCreated }: RecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const buf = await blob.arrayBuffer();
          const durationMs = Date.now() - startTsRef.current;
          const { id } = await api.notes.create({ audio: buf, durationMs });
          onCreated(id);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to save recording');
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      };
      startTsRef.current = Date.now();
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch (err) {
      if ((err as DOMException)?.name === 'NotAllowedError') {
        setError('Microphone access denied. Grant access in your OS settings.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not access microphone');
      }
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  useEffect(() => {
    const unsub = api.onHotkey(() => {
      if (recording) stop();
      else start();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        className={recording ? '' : 'primary'}
        onClick={recording ? stop : start}
        title={recording ? 'Stop recording' : 'Start recording'}
      >
        {recording ? '◼ Stop' : '● Record'}
      </button>
      {error && <small style={{ color: 'var(--accent)' }}>{error}</small>}
    </div>
  );
}
