// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesEvent } from '../lib/api';
import { Sidebar } from './Sidebar';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    notes: {
      list: vi.fn(),
      onEvent: vi.fn(),
    },
    folders: {
      list: vi.fn(),
    },
    onHotkey: vi.fn(() => () => {}),
  },
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
}));

vi.mock('./Recorder', () => ({
  Recorder: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated('created-from-test')}>Mock Record</button>
  ),
}));

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Sidebar', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let emitEvent: ((event: NotesEvent) => void) | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    emitEvent = null;
    mockApi.notes.list.mockReset();
    mockApi.folders.list.mockReset();
    mockApi.notes.onEvent.mockImplementation((cb: (event: NotesEvent) => void) => {
      emitEvent = cb;
      return () => {
        emitEvent = null;
      };
    });
    mockApi.folders.list.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a refresh error while preserving the previous notes list', async () => {
    mockApi.notes.list
      .mockResolvedValueOnce([
        {
          id: 'note-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          title: 'First note',
          status: 'ready',
          durationMs: 65_000,
          folderId: null,
          folderName: null,
        },
      ])
      .mockRejectedValueOnce(new Error('refresh failed'));

    await act(async () => {
      root.render(<Sidebar selectedId="note-1" />);
    });
    await flushPromises();

    expect(container.textContent).toContain('First note');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      emitEvent?.({ type: 'note:updated', payload: { id: 'note-1' } });
    });
    await flushPromises();

    expect(container.textContent).toContain('First note');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('refresh failed');
  });

  it('renders a nested folder tree with counts', async () => {
    mockApi.notes.list.mockResolvedValue([
      {
        id: 'note-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: 'Nested note',
        status: 'ready',
        durationMs: 1_000,
        folderId: 'child',
        folderName: 'Child',
      },
    ]);
    mockApi.folders.list.mockResolvedValue([
      { id: 'parent', name: 'Parent', createdAt: 1, updatedAt: 1, parentId: null },
      { id: 'child', name: 'Child', createdAt: 2, updatedAt: 2, parentId: 'parent' },
    ]);

    await act(async () => {
      root.render(<Sidebar selectedId="note-1" />);
    });
    await flushPromises();

    expect(container.textContent).toContain('Parent');
    expect(container.textContent).toContain('Child');
    expect(container.textContent).toContain('Nested note');
  });
});
