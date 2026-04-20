import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Note } from '../lib/api';
import { extractTitle } from '@shared/title';
import { BackIcon, CheckIcon, EditIcon, RetryIcon, TrashIcon } from '../components/Icons';
import { formatDuration, formatRelativeTime } from '../lib/format';

interface DetailPageProps {
  id: string;
}

type ViewState = 'loading' | 'ready' | 'missing' | 'error';

function statusPillFor(note: Note): { label: string; variant: 'working' | 'failed' | null } {
  switch (note.status) {
    case 'transcribing':
      return { label: 'Transcribing', variant: 'working' };
    case 'generating':
      return { label: 'Generating', variant: 'working' };
    case 'transcription_failed':
      return { label: 'Transcription failed', variant: 'failed' };
    case 'generation_failed':
      return { label: 'Generation failed', variant: 'failed' };
    case 'pending_network':
      return { label: 'Waiting for network', variant: 'working' };
    default:
      return { label: '', variant: null };
  }
}

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

  async function loadNote(
    targetId: string,
    opts?: { preserveDraft?: boolean; background?: boolean },
  ) {
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
      void flushPendingSave({ reportErrors: false }).catch(() => {});
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

  function navigateHome() {
    window.location.hash = '#/';
  }

  if (viewState === 'loading') {
    return (
      <div className="empty-hero">
        <p>Loading note…</p>
      </div>
    );
  }
  if (viewState === 'missing') {
    return (
      <div className="empty-hero">
        <h1>Note not found</h1>
        <p>This note may have been deleted.</p>
        <button className="solid" onClick={navigateHome}>
          <BackIcon /> Back to notes
        </button>
      </div>
    );
  }

  const pill = note ? statusPillFor(note) : null;
  const showEditor = note?.status === 'ready' && editing;
  const showStream = note?.status === 'generating' && streaming;
  const canEdit = note?.status === 'ready';
  const canRetry =
    note?.status === 'transcription_failed' || note?.status === 'generation_failed';

  const displayTitle = note?.title || 'Untitled';
  const isUntitled = !note?.title;

  return (
    <div>
      <div className="detail-toolbar">
        <button className="icon ghost" onClick={navigateHome} aria-label="Back to notes" title="Back">
          <BackIcon />
        </button>
        <div className="crumb">Notes</div>
        {pill && pill.variant && (
          <div className={`status-pill ${pill.variant}`}>
            {pill.variant === 'working' && <span className="orbit" />}
            {pill.label}
          </div>
        )}
        {canEdit && (
          <button className="ghost" onClick={() => void onToggleEditing()}>
            {editing ? <CheckIcon /> : <EditIcon />}
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
        {canRetry && (
          <button className="ghost" onClick={() => void onRetry()}>
            <RetryIcon />
            Retry
          </button>
        )}
        <button
          className="icon ghost"
          onClick={() => void onDelete()}
          aria-label="Delete note"
          title="Delete"
        >
          <TrashIcon />
        </button>
      </div>

      {note && (
        <>
          <h1 className={`note-title ${isUntitled ? 'untitled' : ''}`}>{displayTitle}</h1>
          <div className="note-subhead">
            <span>{formatRelativeTime(note.createdAt)}</span>
            <span className="sep" />
            <span>{formatDuration(note.durationMs)}</span>
          </div>
        </>
      )}

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {viewState === 'error' && !note && (
        <div className="alert muted">Unable to load note.</div>
      )}

      {note && note.status !== 'ready' && note.errorMessage && (
        <div className="alert" role="alert">
          {note.errorMessage}
        </div>
      )}

      {note && (showStream ? (
        <pre className="prose">{streaming}</pre>
      ) : showEditor ? (
        <textarea
          className="editor"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          autoFocus
        />
      ) : (
        <pre className="prose">{note.markdown || ''}</pre>
      ))}

      {note?.transcript && (
        <details className="transcript">
          <summary>Raw transcript</summary>
          <pre>{note.transcript}</pre>
        </details>
      )}

      {note?.audioPath && (
        <div className="audio-actions">
          <button className="ghost" onClick={() => void onDeleteAudio()}>
            <TrashIcon />
            Delete audio file
          </button>
        </div>
      )}
    </div>
  );
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
