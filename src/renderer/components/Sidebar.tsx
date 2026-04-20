import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NoteSummary, NotesEvent } from '../lib/api';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { Recorder } from './Recorder';
import { SearchIcon, SettingsIcon } from './Icons';
import { LogoLockup } from './Logo';

interface SidebarProps {
  selectedId: string | null;
}

interface NoteGroup {
  key: string;
  label: string;
  notes: NoteSummary[];
  nested: boolean;
}

const SEARCH_DEBOUNCE_MS = 200;

function shouldRefreshList(type: NotesEvent['type']): boolean {
  return type !== 'note:streaming';
}

function noteClassName(n: NoteSummary, selectedId: string | null, nested: boolean): string {
  const parts = ['note-item'];
  if (selectedId === n.id) parts.push('active');
  if (nested) parts.push('nested');
  if (n.status === 'transcription_failed' || n.status === 'generation_failed') parts.push('failed');
  else if (n.status !== 'ready') parts.push('pending');
  return parts.join(' ');
}

function groupNotes(notes: NoteSummary[]): NoteGroup[] {
  const grouped = new Map<string, NoteGroup>();
  const ungrouped: NoteSummary[] = [];

  for (const note of notes) {
    if (!note.folderId || !note.folderName) {
      ungrouped.push(note);
      continue;
    }

    const group = grouped.get(note.folderId) ?? {
      key: note.folderId,
      label: note.folderName,
      notes: [],
      nested: true,
    };
    group.notes.push(note);
    grouped.set(note.folderId, group);
  }

  const folderGroups = [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (folderGroups.length === 0) {
    return [{ key: 'all-notes', label: '', notes, nested: false }];
  }

  const out: NoteGroup[] = [];
  if (ungrouped.length > 0) {
    out.push({ key: 'ungrouped', label: 'Ungrouped', notes: ungrouped, nested: true });
  }
  return [...out, ...folderGroups];
}

export function Sidebar({ selectedId }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
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
        const result = await api.notes.list({ search: debouncedSearch });
        if (!cancelled) setNotes(result);
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
  const groups = groupNotes(notes);

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
        {groups.map((group) => (
          <section key={group.key} className="notes-group">
            {group.label && (
              <div className="notes-group-label">
                <span>{group.label}</span>
                <span>{group.notes.length}</span>
              </div>
            )}
            {group.notes.map((n) => (
              <a
                key={n.id}
                href={`#/notes/${n.id}`}
                className={noteClassName(n, selectedId, group.nested)}
              >
                <div className="title">
                  {n.title || (n.status === 'ready' ? 'Untitled' : statusLabel(n.status))}
                </div>
                <div className="meta">
                  <span>{formatRelativeTime(n.createdAt)}</span>
                  <span className="dot-sep" />
                  <span>{formatDuration(n.durationMs)}</span>
                </div>
              </a>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function statusLabel(s: NoteSummary['status']): string {
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
