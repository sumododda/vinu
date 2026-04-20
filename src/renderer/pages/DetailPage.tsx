import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Note } from '../lib/api';

interface DetailPageProps {
  id: string;
}

type ViewState = 'loading' | 'ready' | 'missing' | 'error';

export function DetailPage({ id }: DetailPageProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const currentId = useRef(id);
  const draftRef = useRef('');
  const editingRef = useRef(false);
  const noteRef = useRef<Note | null>(null);

  draftRef.current = draft;
  editingRef.current = editing;
  currentId.current = id;
  noteRef.current = note;

  function clearPendingSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }

  async function saveMarkdown(markdown: string) {
    await api.notes.update(currentId.current, markdown);
    setNote((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        markdown,
        title: extractTitle(markdown),
      };
    });
  }

  async function flushPendingSave(opts?: { reportErrors?: boolean }) {
    const reportErrors = opts?.reportErrors ?? true;
    const next = pendingDraft.current;
    clearPendingSave();
    if (next == null) return true;
    pendingDraft.current = null;

    try {
      await saveMarkdown(next);
      return true;
    } catch (err) {
      pendingDraft.current = next;
      if (reportErrors) setError(getErrorMessage(err, 'Failed to save note'));
      return false;
    }
  }

  async function loadNote(targetId: string, opts?: { preserveDraft?: boolean; background?: boolean }) {
    const preserveDraft = opts?.preserveDraft ?? false;
    const background = opts?.background ?? false;

    if (!background || !noteRef.current) setViewState('loading');
    setError(null);

    const loaded = await api.notes.get(targetId);
    if (!loaded) {
      setNote(null);
      setStreaming(null);
      if (!preserveDraft) setDraft('');
      setViewState('missing');
      return;
    }

    setNote(loaded);
    setStreaming(null);
    if (!preserveDraft) setDraft(loaded.markdown);
    setViewState('ready');
  }

  useEffect(() => {
    let cancelled = false;

    setNote(null);
    setStreaming(null);
    setEditing(false);
    setDraft('');
    setError(null);
    setViewState('loading');
    clearPendingSave();
    pendingDraft.current = null;

    const refresh = async (opts?: { preserveDraft?: boolean; background?: boolean }) => {
      try {
        await loadNote(id, opts);
      } catch (err) {
        if (cancelled) return;
        setStreaming(null);
        setViewState(noteRef.current ? 'ready' : 'error');
        setError(getErrorMessage(err, 'Failed to load note'));
      }
    };

    void refresh();

    const unsub = api.notes.onEvent((e) => {
      if (e.payload.id !== id) return;
      if (e.type === 'note:streaming' && e.payload.markdown) {
        setStreaming(e.payload.markdown);
        return;
      }

      setStreaming(null);
      void refresh({ preserveDraft: editingRef.current, background: true });
    });

    return () => {
      cancelled = true;
      unsub();
      void flushPendingSave({ reportErrors: false });
    };
  }, [id]);

  function onChange(next: string) {
    setDraft(next);
    setError(null);
    pendingDraft.current = next;
    clearPendingSave();
    saveTimer.current = setTimeout(() => {
      const latest = pendingDraft.current;
      if (latest == null) return;
      pendingDraft.current = null;
      void saveMarkdown(latest).catch((err) => {
        pendingDraft.current = latest;
        setError(getErrorMessage(err, 'Failed to save note'));
      });
    }, 500);
  }

  async function onToggleEditing() {
    if (editing) {
      const saved = await flushPendingSave({ reportErrors: true });
      if (!saved) return;
    }
    setEditing((v) => !v);
  }

  async function onRetry() {
    setError(null);
    try {
      await api.notes.retry(id);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to retry note'));
    }
  }

  async function onDelete() {
    if (!confirm('Delete this note?')) return;
    setError(null);
    try {
      clearPendingSave();
      pendingDraft.current = null;
      await api.notes.delete(id);
      window.location.hash = '#/';
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete note'));
    }
  }

  async function onDeleteAudio() {
    setError(null);
    try {
      await api.notes.deleteAudio(id);
      await loadNote(id, { preserveDraft: editing, background: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete audio file'));
    }
  }

  if (viewState === 'loading') return <p>Loading…</p>;
  if (viewState === 'missing') return <p>Note not found.</p>;

  return (
    <div>
      {error && (
        <p style={{ color: 'var(--accent)' }} role="alert">
          {error}
        </p>
      )}

      {viewState === 'error' && !note ? <p>Unable to load note.</p> : null}

      {note && (
        <>
          <div className="toolbar">
            <strong>{note.title || 'Untitled'}</strong>
            <div className="spacer" />
            {note.status === 'ready' && (
              <button onClick={() => void onToggleEditing()}>{editing ? 'Done' : 'Edit'}</button>
            )}
            {(note.status === 'transcription_failed' || note.status === 'generation_failed') && (
              <button onClick={() => void onRetry()}>Retry</button>
            )}
            <button onClick={() => void onDelete()}>Delete</button>
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
              <button onClick={() => void onDeleteAudio()}>Delete audio file</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function extractTitle(markdown: string): string {
  return (markdown.match(/^#\s+(.+?)\s*$/m)?.[1] ?? 'Untitled').trim();
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
