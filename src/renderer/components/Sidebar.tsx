import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Folder, NoteSummary, NotesEvent } from '../lib/api';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { Recorder } from './Recorder';
import { ChevronRightIcon, FolderIcon, SearchIcon, SettingsIcon } from './Icons';
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

const SEARCH_DEBOUNCE_MS = 200;

function shouldRefreshList(type: NotesEvent['type']): boolean {
  return type !== 'note:streaming';
}

function noteClassName(n: NoteSummary, selectedId: string | null): string {
  const parts = ['note-item', 'tree-note'];
  if (selectedId === n.id) parts.push('active');
  if (n.status === 'transcription_failed' || n.status === 'generation_failed') parts.push('failed');
  else if (n.status !== 'ready') parts.push('pending');
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

export function Sidebar({ selectedId }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    void refresh();
    const unsub = api.notes.onEvent((event) => {
      if (shouldRefreshList(event.type)) {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
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

  function isExpanded(node: FolderTreeNode, level: number): boolean {
    if (searching) return true;
    if (expandedFolders[node.folder.id] != null) return expandedFolders[node.folder.id];
    if (folderPath.has(node.folder.id)) return true;
    return level === 0;
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !(prev[folderId] ?? true) }));
  }

  function renderNote(note: NoteSummary, depth: number) {
    return (
      <a
        key={note.id}
        href={`#/notes/${note.id}`}
        className={noteClassName(note, selectedId)}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
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

    return (
      <section key={node.folder.id} className="folder-node">
        <button
          className={`folder-row ${containsSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
          onClick={() => toggleFolder(node.folder.id)}
          aria-expanded={expanded}
        >
          <ChevronRightIcon className={`folder-caret ${expanded ? 'open' : ''}`} />
          <FolderIcon className="folder-glyph" />
          <span className="folder-name">{node.folder.name}</span>
          <span className="folder-count">{node.totalCount}</span>
        </button>

        {expanded && (
          <>
            {node.notes.map((note) => renderNote(note, depth))}
            {node.children.map((child) => renderFolder(child, level + 1))}
          </>
        )}
      </section>
    );
  }

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
              placeholder="Search notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search notes"
            />
          </div>
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
      <div className="notes-list">
        {loading && notes.length === 0 && <p className="loading-row">Loading notes…</p>}
        {error && (
          <p className="loading-row" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {showEmpty && (
          <p className="empty">
            {searching ? 'No notes match this search.' : 'No notes yet — hit Record to start.'}
          </p>
        )}
        {tree.ungrouped.length > 0 && (
          <section className="notes-group">
            <div className="notes-group-label">
              <span>Ungrouped</span>
              <span>{tree.ungrouped.length}</span>
            </div>
            {tree.ungrouped.map((note) => renderNote(note, 0))}
          </section>
        )}
        {tree.roots.map((node) => renderFolder(node, 0))}
      </div>
    </>
  );
}
