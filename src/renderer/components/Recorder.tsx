import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MicIcon, StopIcon } from './Icons';

interface RecorderProps {
  onCreated: (id: string) => void;
}

type RecorderPhase = 'idle' | 'starting' | 'recording' | 'saving';

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export function Recorder({ onCreated }: RecorderProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const phaseRef = useRef<RecorderPhase>('idle');
  const mountedRef = useRef(true);
  const onCreatedRef = useRef(onCreated);
  const stoppedStreamsRef = useRef(new WeakSet<MediaStream>());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
        clearTimer();
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
          if (mountedRef.current) setElapsedMs(0);
          setPhaseSafe('idle');
        }
      };

      startTsRef.current = Date.now();
      mr.start();
      recorderRef.current = mr;
      setPhaseSafe('recording');

      // Tick the UI once a second while recording.
      if (mountedRef.current) setElapsedMs(0);
      timerRef.current = setInterval(() => {
        if (mountedRef.current && phaseRef.current === 'recording') {
          setElapsedMs(Date.now() - startTsRef.current);
        }
      }, 250);
    } catch (err) {
      stopStream(stream);
      recorderRef.current = null;
      chunksRef.current = [];
      clearTimer();
      if (mountedRef.current) setElapsedMs(0);
      setPhaseSafe('idle');

      if ((err as DOMException)?.name === 'NotAllowedError') {
        setErrorSafe('Microphone access denied. Grant access in System Settings.');
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
      clearTimer();
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
      clearTimer();
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

  const buttonClass = recording
    ? 'record recording'
    : busy
      ? 'record busy'
      : 'record primary';

  const buttonLabel =
    phase === 'starting'
      ? 'Starting…'
      : phase === 'saving'
        ? 'Saving…'
        : recording
          ? 'Stop'
          : 'Record';

  const buttonTitle = recording
    ? 'Stop recording (⌘⇧N)'
    : 'Start recording (⌘⇧N)';

  return (
    <div className="recorder">
      <button
        className={buttonClass}
        onClick={recording ? stop : () => void start()}
        title={buttonTitle}
        disabled={busy}
      >
        {recording ? <span className="dot" /> : busy ? null : <MicIcon width={15} height={15} />}
        {recording ? (
          <>
            <StopIcon width={13} height={13} />
            {buttonLabel}
          </>
        ) : (
          buttonLabel
        )}
      </button>
      {recording && <div className="timer">{formatElapsed(elapsedMs)}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
