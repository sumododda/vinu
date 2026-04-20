import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NoteSummary } from '../lib/api';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { Recorder } from './Recorder';

interface SidebarProps {
  selectedId: string | null;
}

export function Sidebar({ selectedId }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<NoteSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      api.notes.list({ search }).then((result) => {
        if (!cancelled) setNotes(result);
      });
    refresh();
    const unsub = api.notes.onEvent(() => refresh());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [search]);

  return (
    <>
      <div className="sidebar-header">
        <Recorder
          onCreated={(id) => {
            window.location.hash = `#/notes/${id}`;
          }}
        />
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search notes"
        />
        <button
          onClick={() => {
            window.location.hash = '#/settings';
          }}
          aria-label="Settings"
        >
          ⚙︎
        </button>
      </div>
      <div className="notes-list">
        {notes.map((n) => (
          <a
            key={n.id}
            href={`#/notes/${n.id}`}
            className={`note-item ${selectedId === n.id ? 'active' : ''}`}
          >
            <div className="title">
              {n.title || (n.status === 'ready' ? 'Untitled' : statusLabel(n.status))}
            </div>
            <div className="meta">
              <span>{formatRelativeTime(n.createdAt)}</span>
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
