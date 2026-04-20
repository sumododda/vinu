import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api';
import type { Folder, NoteSummary, NotesEvent } from '../lib/api';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { Recorder } from './Recorder';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from './Icons';
import { LogoLockup } from './Logo';

interface SidebarProps {
  selectedId: string | null;
}

interface FolderTreeNode {
  folder: Folder;
  children: FolderTreeNode[];
  notes: NoteSummary[];
  totalCount: number;
  noteIds: Set<string>;
}

type CreatingFolder = { parentId: string | null } | null;
type DragPayload = { type: 'note'; id: string } | { type: 'folder'; id: string };

interface FlatRow {
  type: 'note' | 'folder';
  id: string;
  href?: string;
}

const SEARCH_DEBOUNCE_MS = 200;
const NOTE_DRAG_MIME = 'application/x-vinu-note-id';
const FOLDER_DRAG_MIME = 'application/x-vinu-folder-id';
const UNGROUPED_KEY = '__ungrouped__';
const ROOT_DROP_KEY = '__root__';
const EXPANDED_STORAGE_KEY = 'vinu.sidebar.expandedFolders';

function shouldRefreshList(type: NotesEvent['type']): boolean {
  return type !== 'note:streaming';
}

function noteClassName(n: NoteSummary, selectedId: string | null, dragging: boolean, focused: boolean): string {
  const parts = ['note-item', 'tree-note'];
  if (selectedId === n.id) parts.push('active');
  if (n.status === 'transcription_failed' || n.status === 'generation_failed') parts.push('failed');
  else if (n.status !== 'ready') parts.push('pending');
  if (dragging) parts.push('dragging');
  if (focused) parts.push('focused');
  return parts.join(' ');
}

function buildFolderTree(folders: Folder[], notes: NoteSummary[]): {
  roots: FolderTreeNode[];
  ungrouped: NoteSummary[];
} {
  const nodes = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    nodes.set(folder.id, {
      folder,
      children: [],
      notes: [],
      totalCount: 0,
      noteIds: new Set(),
    });
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.folder.parentId ? nodes.get(node.folder.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const ungrouped: NoteSummary[] = [];
  for (const note of notes) {
    if (note.folderId && nodes.has(note.folderId)) {
      nodes.get(note.folderId)?.notes.push(note);
    } else {
      ungrouped.push(note);
    }
  }

  const sortNode = (node: FolderTreeNode) => {
    node.children.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    node.notes.sort((a, b) => b.createdAt - a.createdAt);
    for (const child of node.children) sortNode(child);
  };
  roots.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  for (const root of roots) sortNode(root);

  const annotateNode = (node: FolderTreeNode): FolderTreeNode => {
    for (const note of node.notes) node.noteIds.add(note.id);
    for (const child of node.children) {
      annotateNode(child);
      for (const id of child.noteIds) node.noteIds.add(id);
    }
    node.totalCount = node.noteIds.size;
    return node;
  };
  for (const root of roots) annotateNode(root);

  return { roots, ungrouped };
}

function noteStatusLabel(s: NoteSummary['status']): string {
  switch (s) {
    case 'transcribing':
      return 'Transcribing…';
    case 'generating':
      return 'Generating notes…';
    case 'transcription_failed':
      return 'Transcription failed';
    case 'generation_failed':
      return 'Note generation failed';
    case 'pending_network':
      return 'Waiting for network…';
    default:
      return '';
  }
}

function loadPersistedExpanded(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistExpanded(map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (e.g. quota, disabled)
  }
}

export function Sidebar({ selectedId }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(
    () => loadPersistedExpanded(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState<CreatingFolder>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);
  const [menuFolder, setMenuFolder] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const navigateToNote = useCallback((id: string) => {
    window.location.hash = `#/notes/${id}`;
  }, []);

  const navigateToSettings = useCallback(() => {
    window.location.hash = '#/settings';
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    persistExpanded(expandedFolders);
  }, [expandedFolders]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }

      try {
        const [loadedNotes, loadedFolders] = await Promise.all([
          api.notes.list({ search: debouncedSearch }),
          api.folders.list(),
        ]);
        if (!cancelled) {
          setNotes(loadedNotes);
          setFolders(loadedFolders);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load notes');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    refreshRef.current = refresh;
    void refresh();
    const unsub = api.notes.onEvent((event) => {
      if (shouldRefreshList(event.type)) {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      refreshRef.current = null;
      unsub();
    };
  }, [debouncedSearch]);

  const searching = debouncedSearch.length > 0;
  const showEmpty = !loading && !error && notes.length === 0;
  const tree = useMemo(() => buildFolderTree(folders, notes), [folders, notes]);
  const folderPath = useMemo(() => {
    const parentById = new Map(folders.map((folder) => [folder.id, folder.parentId]));
    const selectedFolderId = notes.find((note) => note.id === selectedId)?.folderId;
    const expanded = new Set<string>();
    let current = selectedFolderId;
    while (current) {
      expanded.add(current);
      current = parentById.get(current) ?? null;
    }
    return expanded;
  }, [folders, notes, selectedId]);

  useEffect(() => {
    if (!selectedId || folderPath.size === 0) return;
    setExpandedFolders((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of folderPath) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folderPath, selectedId]);

  useEffect(() => {
    if (!menuFolder) return;
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.folder-menu-wrap')) return;
      setMenuFolder(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuFolder]);

  function isExpanded(node: FolderTreeNode, level: number): boolean {
    if (searching) return true;
    if (creatingFolder?.parentId === node.folder.id) return true;
    if (expandedFolders[node.folder.id] != null) return expandedFolders[node.folder.id];
    if (folderPath.has(node.folder.id)) return true;
    return level === 0;
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !(prev[folderId] ?? true) }));
  }

  function openCreator(parentId: string | null) {
    setCreatingFolder({ parentId });
    setNewFolderName('');
    setMenuFolder(null);
    if (parentId) {
      setExpandedFolders((prev) => ({ ...prev, [parentId]: true }));
    }
  }

  function cancelCreator() {
    setCreatingFolder(null);
    setNewFolderName('');
  }

  async function submitCreator() {
    const name = newFolderName.trim();
    if (!name || !creatingFolder || creatingBusy) return;
    setCreatingBusy(true);
    try {
      await api.folders.create(name, creatingFolder.parentId ?? null);
      setCreatingFolder(null);
      setNewFolderName('');
      await refreshRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setCreatingBusy(false);
    }
  }

  function onCreatorKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitCreator();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelCreator();
    }
  }

  function startRenamingFolder(folder: Folder) {
    setMenuFolder(null);
    setRenamingFolder({ id: folder.id, name: folder.name });
  }

  function cancelRenameFolder() {
    setRenamingFolder(null);
  }

  async function commitRenameFolder() {
    if (!renamingFolder) return;
    const trimmed = renamingFolder.name.trim();
    const original = folders.find((f) => f.id === renamingFolder.id);
    if (!trimmed) {
      setRenamingFolder(null);
      return;
    }
    if (original && trimmed === original.name) {
      setRenamingFolder(null);
      return;
    }
    try {
      await api.folders.rename(renamingFolder.id, trimmed);
      setRenamingFolder(null);
      await refreshRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename folder');
    }
  }

  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRenameFolder();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameFolder();
    }
  }

  async function deleteFolder(folder: Folder) {
    setMenuFolder(null);
    const hasParent = folder.parentId != null;
    const hasChildren = folders.some((f) => f.parentId === folder.id);
    const hasNotes = notes.some((n) => n.folderId === folder.id);

    let notesDestination: 'parent' | 'ungrouped' = hasParent ? 'parent' : 'ungrouped';
    if (hasNotes) {
      const destinationLabel = hasParent
        ? `Move notes in "${folder.name}" up to "${folders.find((f) => f.id === folder.parentId)?.name ?? 'the parent folder'}"? Click Cancel to move them to Ungrouped instead.`
        : `Delete "${folder.name}" and move its notes to Ungrouped?`;
      const moveToParent = hasParent ? window.confirm(destinationLabel) : true;
      notesDestination = moveToParent && hasParent ? 'parent' : 'ungrouped';
    } else if (!hasChildren) {
      if (!window.confirm(`Delete empty folder "${folder.name}"?`)) return;
    }

    try {
      await api.folders.delete(folder.id, notesDestination);
      await refreshRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
    }
  }

  function onNoteDragStart(event: DragEvent<HTMLAnchorElement>, noteId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(NOTE_DRAG_MIME, noteId);
    event.dataTransfer.setData('text/plain', noteId);
    setDrag({ type: 'note', id: noteId });
  }

  function onFolderDragStart(event: DragEvent<HTMLElement>, folderId: string) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(FOLDER_DRAG_MIME, folderId);
    event.dataTransfer.setData('text/plain', folderId);
    setDrag({ type: 'folder', id: folderId });
  }

  function onDragEnd() {
    setDrag(null);
    setDropTargetKey(null);
  }

  function getDragType(event: DragEvent<HTMLElement>): 'note' | 'folder' | null {
    const types = event.dataTransfer.types ?? [];
    const asArray = Array.from(types as unknown as string[]);
    if (asArray.includes(NOTE_DRAG_MIME)) return 'note';
    if (asArray.includes(FOLDER_DRAG_MIME)) return 'folder';
    return null;
  }

  function canDropOnFolder(dragPayload: DragPayload | null, targetFolderId: string): boolean {
    if (!dragPayload) return false;
    if (dragPayload.type === 'note') return true;
    if (dragPayload.id === targetFolderId) return false;
    if (isDescendant(targetFolderId, dragPayload.id)) return false;
    return true;
  }

  function isDescendant(candidateId: string, ancestorId: string): boolean {
    const parents = new Map(folders.map((f) => [f.id, f.parentId]));
    const seen = new Set<string>();
    let current: string | null | undefined = candidateId;
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      if (current === ancestorId) return true;
      current = parents.get(current) ?? null;
    }
    return false;
  }

  function onDropTargetOver(event: DragEvent<HTMLElement>, key: string, folderId: string | null) {
    const type = getDragType(event);
    if (!type) return;
    if (type === 'folder' && folderId && !canDropOnFolder(drag, folderId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTargetKey !== key) setDropTargetKey(key);
  }

  function onDropTargetLeave(_: DragEvent<HTMLElement>, key: string) {
    setDropTargetKey((prev) => (prev === key ? null : prev));
  }

  async function onDropTargetDrop(
    event: DragEvent<HTMLElement>,
    targetFolderId: string | null,
  ) {
    const type = getDragType(event);
    if (!type) return;
    event.preventDefault();

    if (type === 'note') {
      const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
      setDrag(null);
      setDropTargetKey(null);
      if (!noteId) return;
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      if ((note.folderId ?? null) === targetFolderId) return;

      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, folderId: targetFolderId } : n)),
      );
      try {
        await api.notes.setFolder(noteId, targetFolderId);
        await refreshRef.current?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to move note');
        await refreshRef.current?.();
      }
      return;
    }

    const folderId = event.dataTransfer.getData(FOLDER_DRAG_MIME);
    setDrag(null);
    setDropTargetKey(null);
    if (!folderId) return;
    const source = folders.find((f) => f.id === folderId);
    if (!source) return;
    if ((source.parentId ?? null) === targetFolderId) return;
    if (targetFolderId && !canDropOnFolder({ type: 'folder', id: folderId }, targetFolderId)) return;
    try {
      await api.folders.setParent(folderId, targetFolderId);
      await refreshRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move folder');
    }
  }

  function renderCreatorRow(parentId: string | null, depth: number) {
    if (!creatingFolder || creatingFolder.parentId !== parentId) return null;
    return (
      <div
        className="folder-creator-row"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <FolderIcon className="folder-glyph" />
        <input
          autoFocus
          className="folder-creator-input"
          value={newFolderName}
          placeholder="Folder name"
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={onCreatorKey}
          onBlur={() => {
            if (!newFolderName.trim() && !creatingBusy) cancelCreator();
          }}
          aria-label="New folder name"
          disabled={creatingBusy}
        />
      </div>
    );
  }

  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    rows.push(...tree.ungrouped.map((note) => ({ type: 'note' as const, id: note.id, href: `#/notes/${note.id}` })));
    const visit = (nodes: FolderTreeNode[]) => {
      for (const node of nodes) {
        rows.push({ type: 'folder', id: node.folder.id });
        if (isExpanded(node, 0)) {
          rows.push(...node.notes.map((note) => ({ type: 'note' as const, id: note.id, href: `#/notes/${note.id}` })));
          visit(node.children);
        }
      }
    };
    visit(tree.roots);
    return rows;
    // isExpanded is a closure over every dep already listed; adding it would
    // recompute on every render without changing output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, expandedFolders, searching, folderPath, creatingFolder]);

  function focusSearch() {
    searchInputRef.current?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (flatRows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((prev) => Math.min(flatRows.length - 1, (prev < 0 ? -1 : prev) + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((prev) => Math.max(0, (prev < 0 ? flatRows.length : prev) - 1));
      return;
    }
    if (event.key === 'Enter' && focusedIndex >= 0) {
      const row = flatRows[focusedIndex];
      if (!row) return;
      event.preventDefault();
      if (row.type === 'note' && row.href) {
        window.location.hash = row.href;
      } else if (row.type === 'folder') {
        toggleFolder(row.id);
      }
    }
  }

  useEffect(() => {
    if (focusedIndex < 0) return;
    if (focusedIndex >= flatRows.length) setFocusedIndex(flatRows.length - 1);
  }, [flatRows.length, focusedIndex]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      event.preventDefault();
      focusSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function renderNote(note: NoteSummary, depth: number) {
    const index = flatRows.findIndex((row) => row.type === 'note' && row.id === note.id);
    const focused = focusedIndex === index;
    return (
      <a
        key={note.id}
        href={`#/notes/${note.id}`}
        className={noteClassName(note, selectedId, drag?.type === 'note' && drag.id === note.id, focused)}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        draggable
        onDragStart={(e) => onNoteDragStart(e, note.id)}
        onDragEnd={onDragEnd}
      >
        <div className="title">
          {note.title || (note.status === 'ready' ? 'Untitled' : noteStatusLabel(note.status))}
        </div>
        <div className="meta">
          <span>{formatRelativeTime(note.createdAt)}</span>
          <span className="dot-sep" />
          <span>{formatDuration(note.durationMs)}</span>
        </div>
      </a>
    );
  }

  function renderFolder(node: FolderTreeNode, level: number) {
    if (searching && node.totalCount === 0) return null;
    const expanded = isExpanded(node, level);
    const containsSelected = selectedId ? node.noteIds.has(selectedId) : false;
    const depth = level + 1;
    const folderId = node.folder.id;
    const isDropTarget = dropTargetKey === folderId;
    const isRenaming = renamingFolder?.id === folderId;
    const isMenuOpen = menuFolder === folderId;
    const index = flatRows.findIndex((row) => row.type === 'folder' && row.id === folderId);
    const focused = focusedIndex === index;
    const isEmpty = node.totalCount === 0;

    return (
      <section key={folderId} className="folder-node">
        <div
          className={`folder-row-wrap ${isDropTarget ? 'drag-over' : ''} ${focused ? 'focused' : ''}`}
          draggable={!isRenaming}
          onDragStart={(e) => onFolderDragStart(e, folderId)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDropTargetOver(e, folderId, folderId)}
          onDragLeave={(e) => onDropTargetLeave(e, folderId)}
          onDrop={(e) => void onDropTargetDrop(e, folderId)}
        >
          <button
            className={`folder-row ${containsSelected ? 'selected' : ''}`}
            style={{ paddingLeft: `${12 + level * 16}px` }}
            onClick={() => toggleFolder(folderId)}
            aria-expanded={expanded}
          >
            <ChevronRightIcon className={`folder-caret ${expanded ? 'open' : ''}`} />
            <FolderIcon className="folder-glyph" />
            {isRenaming ? (
              <input
                className="folder-rename-input"
                autoFocus
                value={renamingFolder.name}
                onChange={(e) =>
                  setRenamingFolder((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
                onKeyDown={onRenameKey}
                onBlur={() => void commitRenameFolder()}
                onClick={(e) => e.stopPropagation()}
                aria-label="Rename folder"
              />
            ) : (
              <span className="folder-name">{node.folder.name}</span>
            )}
            <span className="folder-count">{node.totalCount}</span>
          </button>
          <button
            className="folder-add-button"
            onClick={(e) => {
              e.stopPropagation();
              openCreator(folderId);
            }}
            aria-label={`Add folder inside ${node.folder.name}`}
            title="Add subfolder"
          >
            <PlusIcon />
          </button>
          <div className="folder-menu-wrap">
            <button
              className="folder-add-button folder-menu-button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuFolder((prev) => (prev === folderId ? null : folderId));
              }}
              aria-label={`Folder ${node.folder.name} actions`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              title="More actions"
            >
              <MoreIcon />
            </button>
            {isMenuOpen && (
              <div className="folder-menu-popover" role="menu">
                <button role="menuitem" onClick={() => startRenamingFolder(node.folder)}>
                  Rename
                </button>
                <button role="menuitem" onClick={() => openCreator(folderId)}>
                  New subfolder
                </button>
                <button role="menuitem" className="danger" onClick={() => void deleteFolder(node.folder)}>
                  Delete…
                </button>
              </div>
            )}
          </div>
        </div>

        {expanded && (
          <>
            {renderCreatorRow(folderId, depth)}
            {node.notes.map((note) => renderNote(note, depth))}
            {node.children.map((child) => renderFolder(child, level + 1))}
            {isEmpty && !searching && !creatingFolder && (
              <p className="folder-empty-hint" style={{ paddingLeft: `${12 + depth * 16}px` }}>
                No notes here yet — drop one in.
              </p>
            )}
          </>
        )}
      </section>
    );
  }

  const dragActive = drag !== null;
  const ungroupedDropActive = dropTargetKey === UNGROUPED_KEY;
  const ungroupedHasNotes = tree.ungrouped.length > 0;
  const showUngroupedSection =
    ungroupedHasNotes || ungroupedDropActive || (dragActive && drag?.type === 'note');
  const rootDropActive = dropTargetKey === ROOT_DROP_KEY;
  const showRootDropStrip = dragActive && drag?.type === 'folder';

  return (
    <>
      <div className="brand">
        <LogoLockup size={22} />
      </div>
      <div className="sidebar-header">
        <Recorder onCreated={navigateToNote} />
        <div className="sidebar-tools">
          <div className="search-input">
            <SearchIcon />
            <input
              ref={searchInputRef}
              placeholder="Search notes (press /)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search notes"
            />
          </div>
          <button
            className="icon ghost"
            onClick={() => openCreator(null)}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlusIcon />
          </button>
          <button
            className="icon ghost"
            onClick={navigateToSettings}
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
      <div className="notes-list" onKeyDown={onListKeyDown} tabIndex={0}>
        {loading && notes.length === 0 && <p className="loading-row">Loading notes…</p>}
        {error && (
          <p className="loading-row" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {showEmpty && !creatingFolder && (
          <p className="empty">
            {searching ? 'No notes match this search.' : 'No notes yet — hit Record to start.'}
          </p>
        )}
        {showRootDropStrip && (
          <div
            className={`root-drop-strip ${rootDropActive ? 'drag-over' : ''}`}
            onDragOver={(e) => onDropTargetOver(e, ROOT_DROP_KEY, null)}
            onDragLeave={(e) => onDropTargetLeave(e, ROOT_DROP_KEY)}
            onDrop={(e) => void onDropTargetDrop(e, null)}
          >
            Move to top level
          </div>
        )}
        {renderCreatorRow(null, 0)}
        {showUngroupedSection && (
          <section
            className={`notes-group ungrouped-group ${ungroupedDropActive ? 'drag-over' : ''}`}
            onDragOver={(e) => onDropTargetOver(e, UNGROUPED_KEY, null)}
            onDragLeave={(e) => onDropTargetLeave(e, UNGROUPED_KEY)}
            onDrop={(e) => void onDropTargetDrop(e, null)}
          >
            <div className="notes-group-label">
              <span>Ungrouped</span>
              <span>{tree.ungrouped.length}</span>
            </div>
            {tree.ungrouped.length === 0 && dragActive && drag?.type === 'note' && (
              <p className="folder-empty-hint">Drop here to leave the folder.</p>
            )}
            {tree.ungrouped.map((note) => renderNote(note, 0))}
          </section>
        )}
        {tree.roots.map((node) => renderFolder(node, 0))}
      </div>
    </>
  );
}
