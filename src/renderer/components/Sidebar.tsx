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

const SEARCH_DEBOUNCE_MS = 200;

function shouldRefreshList(type: NotesEvent['type']): boolean {
  return type !== 'note:streaming';
}

function noteClassName(n: NoteSummary, selectedId: string | null): string {
  const parts = ['note-item'];
  if (selectedId === n.id) parts.push('active');
  if (n.status === 'transcription_failed' || n.status === 'generation_failed') parts.push('failed');
  else if (n.status !== 'ready') parts.push('pending');
  return parts.join(' ');
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
        {notes.map((n) => (
          <a key={n.id} href={`#/notes/${n.id}`} className={noteClassName(n, selectedId)}>
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
