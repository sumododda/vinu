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
      setFolder: vi.fn(),
      onEvent: vi.fn(),
    },
    folders: {
      list: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      setParent: vi.fn(),
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
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    emitEvent = null;
    mockApi.notes.list.mockReset();
    mockApi.notes.setFolder.mockReset();
    mockApi.folders.list.mockReset();
    mockApi.folders.create.mockReset();
    mockApi.notes.onEvent.mockImplementation((cb: (event: NotesEvent) => void) => {
      emitEvent = cb;
      return () => {
        emitEvent = null;
      };
    });
    mockApi.folders.list.mockResolvedValue([]);
    mockApi.notes.setFolder.mockResolvedValue(undefined);
    mockApi.folders.create.mockResolvedValue({
      id: 'folder-1',
      name: 'Folder',
      createdAt: 1,
      updatedAt: 1,
      parentId: null,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  function makeDataTransfer(): DataTransfer {
    const store = new Map<string, string>();
    const types: string[] = [];
    return {
      effectAllowed: 'move',
      dropEffect: 'move',
      get types() {
        return types;
      },
      setData(type: string, value: string) {
        store.set(type, value);
        if (!types.includes(type)) types.push(type);
      },
      getData(type: string) {
        return store.get(type) ?? '';
      },
      clearData() {
        store.clear();
        types.length = 0;
      },
      setDragImage() {},
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    } as unknown as DataTransfer;
  }

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

  it('creates a new top-level folder from the sidebar', async () => {
    mockApi.notes.list.mockResolvedValue([]);
    mockApi.folders.list.mockResolvedValue([]);

    await act(async () => {
      root.render(<Sidebar selectedId={null} />);
    });
    await flushPromises();

    await act(async () => {
      (container.querySelector('[aria-label="New folder"]') as HTMLButtonElement).click();
    });
    await flushPromises();

    const input = container.querySelector(
      'input[aria-label="New folder name"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    mockApi.folders.list.mockResolvedValueOnce([
      { id: 'folder-1', name: 'Ideas', createdAt: 1, updatedAt: 1, parentId: null },
    ]);

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      descriptor?.set?.call(input, 'Ideas');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await flushPromises();

    expect(mockApi.folders.create).toHaveBeenCalledWith('Ideas', null);
  });

  it('moves a note when dropped onto a folder row', async () => {
    mockApi.notes.list.mockResolvedValue([
      {
        id: 'note-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: 'Dragme',
        status: 'ready',
        durationMs: 1_000,
        folderId: null,
        folderName: null,
      },
    ]);
    mockApi.folders.list.mockResolvedValue([
      { id: 'f1', name: 'Inbox', createdAt: 1, updatedAt: 1, parentId: null },
    ]);

    await act(async () => {
      root.render(<Sidebar selectedId={null} />);
    });
    await flushPromises();

    const noteLink = container.querySelector('a.tree-note') as HTMLAnchorElement;
    const folderWrap = container.querySelector('.folder-row-wrap') as HTMLElement;
    expect(noteLink).not.toBeNull();
    expect(folderWrap).not.toBeNull();

    const dt = makeDataTransfer();

    await act(async () => {
      const start = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(start, 'dataTransfer', { value: dt });
      noteLink.dispatchEvent(start);
    });

    await act(async () => {
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: dt });
      folderWrap.dispatchEvent(over);
    });

    await act(async () => {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: dt });
      folderWrap.dispatchEvent(drop);
    });
    await flushPromises();

    expect(mockApi.notes.setFolder).toHaveBeenCalledWith('note-1', 'f1');
  });
});
