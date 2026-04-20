import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Folder, Note } from '../lib/api';
import { extractTitle } from '@shared/title';
import { BackIcon, CheckIcon, EditIcon, RetryIcon, TrashIcon } from '../components/Icons';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { renderNoteHtml } from '../lib/note-html';

interface DetailPageProps {
  id: string;
}

type ViewState = 'loading' | 'ready' | 'missing' | 'error';
type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

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
  const [folders, setFolders] = useState<Folder[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const currentId = useRef(id);
  const draftRef = useRef('');
  const editingRef = useRef(false);
  const noteRef = useRef<Note | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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
    setFolders([]);
    setStreaming(null);
    setEditing(false);
    setDraft('');
    setError(null);
    setFolderDraft('');
    setShowFolderCreator(false);
    setViewState('loading');
    clearPendingSave();
    pendingDraft.current = null;

    const refreshNote = async (opts?: { preserveDraft?: boolean; background?: boolean }) => {
      try {
        await loadNote(id, opts);
      } catch (err) {
        if (cancelled) return;
        setStreaming(null);
        setViewState(noteRef.current ? 'ready' : 'error');
        setError(getErrorMessage(err, 'Failed to load note'));
      }
    };

    const refreshFolders = async () => {
      try {
        const loadedFolders = await api.folders.list();
        if (!cancelled) setFolders(loadedFolders);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load folders'));
        }
      }
    };

    void refreshNote();
    void refreshFolders();

    const unsub = api.notes.onEvent((e) => {
      if (e.payload.id !== id) return;
      if (e.type === 'note:streaming' && e.payload.markdown) {
        setStreaming(e.payload.markdown);
        return;
      }

      setStreaming(null);
      void refreshNote({ preserveDraft: editingRef.current, background: true });
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

  function applyDraftUpdate(next: string, selectionStart?: number, selectionEnd?: number) {
    onChange(next);
    if (selectionStart == null || selectionEnd == null) return;

    requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function wrapSelection(prefix: string, suffix: string, fallback: string) {
    const textarea = editorRef.current;
    const current = draftRef.current;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const selected = current.slice(start, end) || fallback;
    const next = `${current.slice(0, start)}${prefix}${selected}${suffix}${current.slice(end)}`;
    const selectionStart = start + prefix.length;
    const selectionEnd = selectionStart + selected.length;
    applyDraftUpdate(next, selectionStart, selectionEnd);
  }

  function insertSnippet(snippet: string) {
    const textarea = editorRef.current;
    const current = draftRef.current;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`;
    const caret = start + snippet.length;
    applyDraftUpdate(next, caret, caret);
  }

  function onHighlight(color: HighlightColor) {
    const selection = editorRef.current
      ? draftRef.current.slice(editorRef.current.selectionStart, editorRef.current.selectionEnd)
      : '';
    if (selection.includes('\n')) {
      wrapSelection(`\n\n:::highlight ${color}\n`, '\n:::\n\n', 'Highlighted lines');
      return;
    }
    wrapSelection(`==${color}::`, '==', 'highlighted text');
  }

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const alt = file.name.replace(/\.[^.]+$/, '') || 'Inline image';
      insertSnippet(`\n\n![${alt}](${dataUrl})\n\n`);
      event.target.value = '';
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to read image'));
    }
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

  async function onSelectFolder(nextFolderId: string) {
    const folderId = nextFolderId || null;
    const folderName = folderId ? folders.find((folder) => folder.id === folderId)?.name ?? null : null;
    setError(null);
    try {
      await api.notes.setFolder(id, folderId);
      setNote((prev) => (prev ? { ...prev, folderId, folderName } : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to move note'));
    }
  }

  async function onCreateFolder() {
    const name = folderDraft.trim();
    if (!name) return;

    setError(null);
    try {
      const folder = await api.folders.create(name);
      setFolders((prev) => {
        const withoutDupe = prev.filter((item) => item.id !== folder.id);
        return [...withoutDupe, folder].sort((a, b) => a.name.localeCompare(b.name));
      });
      await api.notes.setFolder(id, folder.id);
      setNote((prev) => (prev ? { ...prev, folderId: folder.id, folderName: folder.name } : prev));
      setFolderDraft('');
      setShowFolderCreator(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create folder'));
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
  const renderedHtml = renderNoteHtml(showStream ? streaming ?? '' : note?.markdown ?? '');

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
            {note.folderName && (
              <>
                <span className="sep" />
                <span>{note.folderName}</span>
              </>
            )}
          </div>

          <div className="note-controls card">
            <div className="field">
              <label htmlFor="folder-select">Folder</label>
              <div className="folder-actions">
                <select
                  id="folder-select"
                  value={note.folderId ?? ''}
                  onChange={(e) => void onSelectFolder(e.target.value)}
                >
                  <option value="">Ungrouped</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                {!showFolderCreator ? (
                  <button className="solid" onClick={() => setShowFolderCreator(true)}>
                    New folder
                  </button>
                ) : (
                  <>
                    <input
                      type="text"
                      value={folderDraft}
                      onChange={(e) => setFolderDraft(e.target.value)}
                      placeholder="Folder name"
                      aria-label="New folder name"
                    />
                    <button
                      className="primary"
                      onClick={() => void onCreateFolder()}
                      disabled={!folderDraft.trim()}
                    >
                      Create
                    </button>
                    <button
                      className="ghost"
                      onClick={() => {
                        setShowFolderCreator(false);
                        setFolderDraft('');
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
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

      {showEditor ? (
        <>
          <div className="editor-toolbar">
            <button className="solid" onClick={() => imageInputRef.current?.click()}>
              Inline image
            </button>
            <button className="highlight-button yellow" onClick={() => onHighlight('yellow')}>
              Yellow
            </button>
            <button className="highlight-button green" onClick={() => onHighlight('green')}>
              Green
            </button>
            <button className="highlight-button blue" onClick={() => onHighlight('blue')}>
              Blue
            </button>
            <button className="highlight-button pink" onClick={() => onHighlight('pink')}>
              Pink
            </button>
          </div>
          <p className="editor-note">
            Images are embedded inline in the note body. Highlight a word or a few lines, then pick
            a color to wrap that selection.
          </p>
          <textarea
            ref={editorRef}
            className="editor"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            spellCheck
            autoFocus
          />
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={(e) => void onPickImage(e)}
          />
        </>
      ) : (
        <article
          className={`prose rendered-note ${showStream ? 'streaming-note' : ''}`}
          dangerouslySetInnerHTML={{
            __html: renderedHtml || '<p class="empty-note">This note is empty.</p>',
          }}
        />
      )}

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
