import { type ChangeEvent, type DragEvent, type ClipboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Folder, Note } from '../lib/api';
import { extractTitle } from '@shared/title';
import {
  BackIcon,
  CheckIcon,
  EditIcon,
  ImageIcon,
  RetryIcon,
  TrashIcon,
} from '../components/Icons';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { renderNoteHtml } from '../lib/note-html';
import {
  hydrateInlineImages,
  normalizeInlineImagesForEditing,
} from '@shared/note-content';

interface DetailPageProps {
  id: string;
}

type ViewState = 'loading' | 'ready' | 'missing' | 'error';
type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
type FolderOption = { id: string; label: string };
type EditorMode = 'write' | 'preview';

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_IMAGE_BATCH_BYTES = 12 * 1024 * 1024;
const MAX_INLINE_IMAGE_COUNT = 8;
const SAFE_INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

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
  const [editorMode, setEditorMode] = useState<EditorMode>('write');
  const [draft, setDraft] = useState('');
  const [inlineImages, setInlineImages] = useState<Record<string, string>>({});
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderParentDraft, setFolderParentDraft] = useState('');
  const [draggingImages, setDraggingImages] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const currentId = useRef(id);
  const draftRef = useRef('');
  const inlineImagesRef = useRef<Record<string, string>>({});
  const editingRef = useRef(false);
  const noteRef = useRef<Note | null>(null);
  const transcriptDraftRef = useRef('');
  const transcriptDirtyRef = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  draftRef.current = draft;
  inlineImagesRef.current = inlineImages;
  editingRef.current = editing;
  currentId.current = id;
  noteRef.current = note;
  transcriptDraftRef.current = transcriptDraft;
  transcriptDirtyRef.current = transcriptDirty;

  const folderOptions = useMemo(() => flattenFolderOptions(folders), [folders]);

  function clearPendingSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }

  async function saveMarkdown(markdown: string) {
    const rawMarkdown = hydrateInlineImages(markdown, inlineImagesRef.current);
    await api.notes.update(currentId.current, rawMarkdown);
    setNote((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        markdown: rawMarkdown,
        title: extractTitle(rawMarkdown),
      };
    });
  }

  async function saveTranscript(transcript: string) {
    await api.notes.updateTranscript(currentId.current, transcript);
    setTranscriptDirty(false);
    setNote((prev) => (prev ? { ...prev, transcript } : prev));
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

  async function flushTranscriptSave(opts?: { reportErrors?: boolean }) {
    const reportErrors = opts?.reportErrors ?? true;
    if (!transcriptDirtyRef.current) return true;
    try {
      await saveTranscript(transcriptDraftRef.current);
      return true;
    } catch (err) {
      if (reportErrors) setError(getErrorMessage(err, 'Failed to save transcript'));
      return false;
    }
  }

  async function loadNote(
    targetId: string,
    opts?: {
      preserveDraft?: boolean;
      preserveTranscript?: boolean;
      background?: boolean;
    },
  ) {
    const preserveDraft = opts?.preserveDraft ?? false;
    const preserveTranscript = opts?.preserveTranscript ?? false;
    const background = opts?.background ?? false;

    if (!background || !noteRef.current) setViewState('loading');
    setError(null);

    const loaded = await api.notes.get(targetId);
    if (!loaded) {
      setNote(null);
      setStreaming(null);
      if (!preserveDraft) {
        setDraft('');
        setInlineImages({});
      }
      if (!preserveTranscript) {
        setTranscriptDraft('');
        setTranscriptDirty(false);
      }
      setViewState('missing');
      return;
    }

    setNote(loaded);
    setStreaming(null);
    if (!preserveDraft) {
      const editable = normalizeInlineImagesForEditing(loaded.markdown);
      setDraft(editable.markdown);
      setInlineImages(editable.inlineImages);
    }
    if (!preserveTranscript) {
      setTranscriptDraft(loaded.transcript);
      setTranscriptDirty(false);
    }
    setViewState('ready');
  }

  useEffect(() => {
    let cancelled = false;

    setNote(null);
    setFolders([]);
    setStreaming(null);
    setEditing(false);
    setEditorMode('write');
    setDraft('');
    setInlineImages({});
    setTranscriptDraft('');
    setTranscriptDirty(false);
    setError(null);
    setFolderDraft('');
    setFolderParentDraft('');
    setShowFolderCreator(false);
    setDraggingImages(false);
    dragDepth.current = 0;
    setViewState('loading');
    clearPendingSave();
    pendingDraft.current = null;

    const refreshNote = async (opts?: {
      preserveDraft?: boolean;
      preserveTranscript?: boolean;
      background?: boolean;
    }) => {
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
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load folders'));
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
      void refreshNote({
        preserveDraft: editingRef.current,
        preserveTranscript: transcriptDirtyRef.current,
        background: true,
      });
    });

    return () => {
      cancelled = true;
      unsub();
      void flushPendingSave({ reportErrors: false }).catch(() => {});
      void flushTranscriptSave({ reportErrors: false }).catch(() => {});
    };
  }, [id]);

  function onChange(next: string) {
    const editable = normalizeInlineImagesForEditing(next, inlineImagesRef.current);
    setDraft(editable.markdown);
    setInlineImages(editable.inlineImages);
    setError(null);
    pendingDraft.current = editable.markdown;
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

  function onTranscriptChange(next: string) {
    setTranscriptDraft(next);
    setTranscriptDirty(true);
    setError(null);
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

  async function insertImages(files: File[], fallbackLabel: string) {
    if (files.length === 0) return;
    if (files.length > MAX_INLINE_IMAGE_COUNT) {
      setError(`You can insert up to ${MAX_INLINE_IMAGE_COUNT} images at once.`);
      return;
    }

    const unsupported = files.find((file) => !SAFE_INLINE_IMAGE_TYPES.has(file.type.toLowerCase()));
    if (unsupported) {
      setError(`"${unsupported.name}" uses an unsupported image format. Use PNG, JPEG, GIF, WebP, AVIF, or BMP.`);
      return;
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_INLINE_IMAGE_BATCH_BYTES) {
      setError('That image batch is too large to embed inline safely.');
      return;
    }

    const tooLarge = files.find((file) => file.size > MAX_INLINE_IMAGE_BYTES);
    if (tooLarge) {
      setError(`"${tooLarge.name}" is too large to embed inline. Keep each image under 5 MB.`);
      return;
    }

    try {
      const snippets: string[] = [];
      let nextInlineImages = { ...inlineImagesRef.current };
      for (const [index, file] of files.entries()) {
        const dataUrl = await readFileAsDataUrl(file);
        const alt = file.name.replace(/\.[^.]+$/, '') || `${fallbackLabel} ${index + 1}`;
        const editable = normalizeInlineImagesForEditing(`![${alt}](${dataUrl})`, nextInlineImages);
        nextInlineImages = {
          ...nextInlineImages,
          ...editable.inlineImages,
        };
        snippets.push(editable.markdown);
      }
      setInlineImages(nextInlineImages);
      insertSnippet(`\n\n${snippets.join('\n\n')}\n\n`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to read image'));
    }
  }

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].filter((file) => file.type.startsWith('image/'));
    await insertImages(files, 'Inline image');
    event.target.value = '';
  }

  async function onPasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items]
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;

    event.preventDefault();
    await insertImages(files, 'Pasted image');
  }

  function hasDraggedImages(dataTransfer: DataTransfer): boolean {
    return [...dataTransfer.items].some((item) => item.type.startsWith('image/'))
      || [...dataTransfer.files].some((file) => file.type.startsWith('image/'));
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingImages(true);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDraggingImages(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingImages(false);
  }

  async function onDropImages(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingImages(false);
    editorRef.current?.focus();
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
    await insertImages(files, 'Dropped image');
  }

  async function onToggleEditing() {
    if (editing) {
      const saved = await flushPendingSave({ reportErrors: true });
      if (!saved) return;
    } else {
      setEditorMode('write');
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

  async function onSaveTranscript() {
    setError(null);
    const saved = await flushTranscriptSave({ reportErrors: true });
    if (!saved) return;
  }

  async function onRegenerate() {
    if (!transcriptDraftRef.current.trim()) {
      setError('Transcript is empty. Add or correct the transcript first.');
      return;
    }

    const currentNote = noteRef.current;
    const hasBody = Boolean(currentNote?.markdown.trim());
    const hasUnsavedNoteDraft =
      draftRef.current !== (currentNote?.markdown ?? '') || pendingDraft.current != null;
    if (hasBody && hasUnsavedNoteDraft) {
      const ok = confirm('Regenerating will replace the current note body with a new version from the transcript. Continue?');
      if (!ok) return;
    }

    const transcriptSaved = await flushTranscriptSave({ reportErrors: true });
    if (!transcriptSaved) return;

    clearPendingSave();
    pendingDraft.current = null;
    setEditing(false);
    setError(null);
    try {
      await api.notes.regenerate(id);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to regenerate note'));
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
      await loadNote(id, {
        preserveDraft: editing,
        preserveTranscript: transcriptDirtyRef.current,
        background: true,
      });
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
      const folder = await api.folders.create(name, folderParentDraft || null);
      setFolders((prev) => [...prev.filter((item) => item.id !== folder.id), folder]);
      await api.notes.setFolder(id, folder.id);
      setNote((prev) => (prev ? { ...prev, folderId: folder.id, folderName: folder.name } : prev));
      setFolderDraft('');
      setFolderParentDraft(folder.id);
      setShowFolderCreator(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create folder'));
    }
  }

  function openFolderCreator() {
    setFolderDraft('');
    setFolderParentDraft(note?.folderId ?? '');
    setShowFolderCreator(true);
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
  const activeMarkdown = showEditor
    ? hydrateInlineImages(draft, inlineImages)
    : showStream
      ? streaming ?? ''
      : note?.markdown ?? '';
  const renderedHtml = renderNoteHtml(activeMarkdown);
  const currentFolderLabel = note?.folderName ?? 'Ungrouped';

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
            <span className="sep" />
            <span>{currentFolderLabel}</span>
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
                  {folderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!showFolderCreator ? (
                  <button className="solid" onClick={openFolderCreator}>
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
                    <select
                      value={folderParentDraft}
                      onChange={(e) => setFolderParentDraft(e.target.value)}
                      aria-label="Parent folder"
                    >
                      <option value="">Top level</option>
                      {folderOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
                        setFolderParentDraft('');
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
        <section className="editor-shell">
          <div className="editor-header">
            <div className="editor-toolbar">
              <button
                className="solid"
                onClick={() => imageInputRef.current?.click()}
                disabled={editorMode !== 'write'}
              >
                <ImageIcon />
                Inline image
              </button>
              <button
                className="highlight-button yellow"
                onClick={() => onHighlight('yellow')}
                disabled={editorMode !== 'write'}
              >
                Yellow
              </button>
              <button
                className="highlight-button green"
                onClick={() => onHighlight('green')}
                disabled={editorMode !== 'write'}
              >
                Green
              </button>
              <button
                className="highlight-button blue"
                onClick={() => onHighlight('blue')}
                disabled={editorMode !== 'write'}
              >
                Blue
              </button>
              <button
                className="highlight-button pink"
                onClick={() => onHighlight('pink')}
                disabled={editorMode !== 'write'}
              >
                Pink
              </button>
            </div>

            <div className="editor-mode-toggle" role="tablist" aria-label="Editor mode">
              <button
                className={`editor-mode-tab ${editorMode === 'write' ? 'active' : ''}`}
                onClick={() => setEditorMode('write')}
                aria-selected={editorMode === 'write'}
              >
                Write
              </button>
              <button
                className={`editor-mode-tab ${editorMode === 'preview' ? 'active' : ''}`}
                onClick={() => {
                  setDraggingImages(false);
                  setEditorMode('preview');
                }}
                aria-selected={editorMode === 'preview'}
              >
                Preview
              </button>
            </div>
          </div>

          <p className="editor-note">
            {editorMode === 'write'
              ? 'Paste or drag images straight into the editor. Inline images stay compact while you write.'
              : 'Preview the full note with inline images and highlights before you leave edit mode.'}
          </p>
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.bmp"
            multiple
            onChange={(e) => void onPickImage(e)}
          />

          {editorMode === 'write' ? (
            <div
              className={`editor-pane ${draggingImages ? 'dragging' : ''}`}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={(event) => void onDropImages(event)}
            >
              <textarea
                ref={editorRef}
                className="editor"
                value={draft}
                onChange={(e) => onChange(e.target.value)}
                onPaste={(event) => void onPasteImage(event)}
                spellCheck
                autoFocus
              />
              {draggingImages && (
                <div className="drop-overlay">
                  <span>Drop images to embed them inline</span>
                </div>
              )}
            </div>
          ) : (
            <div className="preview-pane">
              <article
                className="prose rendered-note editor-preview"
                dangerouslySetInnerHTML={{
                  __html: renderedHtml || '<p class="empty-note">This note is empty.</p>',
                }}
              />
            </div>
          )}
        </section>
      ) : (
        <article
          className={`prose rendered-note ${showStream ? 'streaming-note' : ''}`}
          dangerouslySetInnerHTML={{
            __html: renderedHtml || '<p class="empty-note">This note is empty.</p>',
          }}
        />
      )}

      <section className="transcript-card card">
        <div className="transcript-header-row">
          <div>
            <h3>Transcript</h3>
            <p className="card-desc">
              Correct wording, add missing context, then regenerate the note from this edited transcript.
            </p>
          </div>
          <div className="transcript-actions">
            {transcriptDirty && <span className="transcript-dirty">Unsaved</span>}
            <button className="ghost" onClick={() => void onSaveTranscript()} disabled={!transcriptDirty}>
              Save transcript
            </button>
            <button
              className="primary"
              onClick={() => void onRegenerate()}
              disabled={!transcriptDraft.trim() || note?.status === 'transcribing' || note?.status === 'generating'}
            >
              {note?.markdown ? 'Regenerate note' : 'Generate note'}
            </button>
          </div>
        </div>
        <textarea
          className="transcript-editor"
          value={transcriptDraft}
          onChange={(e) => onTranscriptChange(e.target.value)}
          spellCheck
        />
      </section>

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

function buildFolderChildren(folders: Folder[]): Map<string | null, Folder[]> {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const bucket = byParent.get(key) ?? [];
    bucket.push(folder);
    byParent.set(key, bucket);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byParent;
}

function flattenFolderOptions(folders: Folder[]): FolderOption[] {
  const byParent = buildFolderChildren(folders);
  const out: FolderOption[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const folder of children) {
      out.push({
        id: folder.id,
        label: `${'  '.repeat(depth)}${depth > 0 ? '> ' : ''}${folder.name}`,
      });
      visit(folder.id, depth + 1);
    }
  };

  visit(null, 0);
  return out;
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
