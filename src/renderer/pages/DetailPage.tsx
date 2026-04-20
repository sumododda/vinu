import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Note } from '../lib/api';

interface DetailPageProps {
  id: string;
}

export function DetailPage({ id }: DetailPageProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.notes.get(id).then((n) => {
      if (cancelled) return;
      setNote(n);
      setDraft(n?.markdown ?? '');
    });
    const unsub = api.notes.onEvent((e) => {
      if (e.payload.id !== id) return;
      if (e.type === 'note:streaming' && e.payload.markdown) {
        setStreaming(e.payload.markdown);
      } else {
        setStreaming(null);
        api.notes.get(id).then((n) => {
          if (cancelled) return;
          setNote(n);
          if (!editing && n) setDraft(n.markdown);
        });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [id, editing]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function onChange(next: string) {
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.notes.update(id, next);
    }, 500);
  }

  if (!note) return <p>Loading…</p>;

  return (
    <div>
      <div className="toolbar">
        <strong>{note.title || 'Untitled'}</strong>
        <div className="spacer" />
        {note.status === 'ready' && (
          <button onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</button>
        )}
        {(note.status === 'transcription_failed' || note.status === 'generation_failed') && (
          <button onClick={() => api.notes.retry(id)}>Retry</button>
        )}
        <button
          onClick={async () => {
            if (!confirm('Delete this note?')) return;
            await api.notes.delete(id);
            window.location.hash = '#/';
          }}
        >
          Delete
        </button>
      </div>

      {note.status !== 'ready' && (
        <p style={{ color: 'var(--muted)' }}>
          Status: {note.status}
          {note.errorMessage ? ` — ${note.errorMessage}` : null}
        </p>
      )}

      {note.status === 'generating' && streaming ? (
        <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{streaming}</pre>
      ) : editing ? (
        <textarea className="editor" value={draft} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{note.markdown || ''}</pre>
      )}

      {note.transcript && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ color: 'var(--muted)' }}>Show raw transcript</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{note.transcript}</pre>
        </details>
      )}

      {note.audioPath && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={async () => {
              await api.notes.deleteAudio(id);
              const fresh = await api.notes.get(id);
              setNote(fresh);
            }}
          >
            Delete audio file
          </button>
        </div>
      )}
    </div>
  );
}
