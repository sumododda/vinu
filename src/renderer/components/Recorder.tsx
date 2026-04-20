import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface RecorderProps {
  onCreated: (id: string) => void;
}

type RecorderPhase = 'idle' | 'starting' | 'recording' | 'saving';

export function Recorder({ onCreated }: RecorderProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const phaseRef = useRef<RecorderPhase>('idle');
  const mountedRef = useRef(true);
  const onCreatedRef = useRef(onCreated);
  const stoppedStreamsRef = useRef(new WeakSet<MediaStream>());

  function setPhaseSafe(next: RecorderPhase) {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }

  function setErrorSafe(message: string | null) {
    if (mountedRef.current) setError(message);
  }

  function stopStream(stream: MediaStream | null) {
    if (!stream || stoppedStreamsRef.current.has(stream)) return;
    stoppedStreamsRef.current.add(stream);
    if (streamRef.current === stream) streamRef.current = null;
    stream.getTracks().forEach((track) => track.stop());
  }

  async function start() {
    if (phaseRef.current !== 'idle') return;

    setErrorSafe(null);
    setPhaseSafe('starting');

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mr.onstop = async () => {
        recorderRef.current = null;
        setPhaseSafe('saving');

        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const audio = await blob.arrayBuffer();
          const durationMs = Date.now() - startTsRef.current;
          const { id } = await api.notes.create({ audio, durationMs });
          onCreatedRef.current(id);
        } catch (err) {
          setErrorSafe(err instanceof Error ? err.message : 'Failed to save recording');
        } finally {
          stopStream(stream);
          chunksRef.current = [];
          setPhaseSafe('idle');
        }
      };

      startTsRef.current = Date.now();
      mr.start();
      recorderRef.current = mr;
      setPhaseSafe('recording');
    } catch (err) {
      stopStream(stream);
      recorderRef.current = null;
      chunksRef.current = [];
      setPhaseSafe('idle');

      if ((err as DOMException)?.name === 'NotAllowedError') {
        setErrorSafe('Microphone access denied. Grant access in your OS settings.');
      } else {
        setErrorSafe(err instanceof Error ? err.message : 'Could not access microphone');
      }
    }
  }

  function stop() {
    if (phaseRef.current !== 'recording') return;
    const recorder = recorderRef.current;
    if (!recorder) {
      stopStream(streamRef.current);
      setPhaseSafe('idle');
      return;
    }

    setPhaseSafe('saving');
    recorder.stop();
  }

  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = api.onHotkey(() => {
      if (phaseRef.current === 'recording') stop();
      else if (phaseRef.current === 'idle') void start();
    });

    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      stopStream(streamRef.current);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recording = phase === 'recording';
  const busy = phase === 'starting' || phase === 'saving';
  const buttonLabel =
    phase === 'starting'
      ? 'Starting…'
      : phase === 'saving'
        ? 'Saving…'
        : recording
          ? '◼ Stop'
          : '● Record';
  const buttonTitle = recording ? 'Stop recording' : 'Start recording';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        className={recording ? '' : 'primary'}
        onClick={recording ? stop : () => void start()}
        title={buttonTitle}
        disabled={busy}
      >
        {buttonLabel}
      </button>
      {error && <small style={{ color: 'var(--accent)' }}>{error}</small>}
    </div>
  );
}
