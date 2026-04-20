// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NotesEvent } from '../lib/api';
import { DetailPage } from './DetailPage';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    notes: {
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteAudio: vi.fn(),
      retry: vi.fn(),
      onEvent: vi.fn(),
    },
  },
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
}));

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    createdAt: 1,
    updatedAt: 1,
    title: 'Original title',
    status: 'ready',
    durationMs: 1_000,
    markdown: 'Original body',
    transcript: '',
    audioPath: null,
    errorMessage: null,
    modelUsed: null,
    provider: null,
    ...overrides,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((button) => button.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('DetailPage', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let emitEvent: ((event: NotesEvent) => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    emitEvent = null;

    mockApi.notes.get.mockReset();
    mockApi.notes.update.mockReset();
    mockApi.notes.delete.mockReset();
    mockApi.notes.deleteAudio.mockReset();
    mockApi.notes.retry.mockReset();
    mockApi.notes.onEvent.mockImplementation((cb: (event: NotesEvent) => void) => {
      emitEvent = cb;
      return () => {
        emitEvent = null;
      };
    });
    mockApi.notes.update.mockResolvedValue(undefined);
    mockApi.notes.delete.mockResolvedValue(undefined);
    mockApi.notes.deleteAudio.mockResolvedValue(undefined);
    mockApi.notes.retry.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('flushes a pending edit immediately when Done is clicked', async () => {
    mockApi.notes.get.mockResolvedValue(makeNote());

    await act(async () => {
      root.render(<DetailPage id="note-1" />);
    });
    await flushPromises();

    await act(async () => {
      getButton(container, 'Edit').click();
    });
    await flushPromises();

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, '# Updated title\n\nUpdated body');
    });

    await act(async () => {
      getButton(container, 'Done').click();
    });
    await flushPromises();

    expect(mockApi.notes.update).toHaveBeenCalledTimes(1);
    expect(mockApi.notes.update).toHaveBeenCalledWith('note-1', '# Updated title\n\nUpdated body');
    expect(container.textContent).toContain('Updated body');
    expect(container.textContent).toContain('Updated title');
  });

  it('flushes a pending edit when the page unmounts', async () => {
    mockApi.notes.get.mockResolvedValue(makeNote());

    await act(async () => {
      root.render(<DetailPage id="note-1" />);
    });
    await flushPromises();

    await act(async () => {
      getButton(container, 'Edit').click();
    });
    await flushPromises();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(textarea, 'Draft before navigation');
    });

    await act(async () => {
      root.unmount();
    });
    await flushPromises();

    expect(mockApi.notes.update).toHaveBeenCalledTimes(1);
    expect(mockApi.notes.update).toHaveBeenCalledWith('note-1', 'Draft before navigation');
  });

  it('renders an explicit missing-note state', async () => {
    mockApi.notes.get.mockResolvedValue(null);

    await act(async () => {
      root.render(<DetailPage id="missing-note" />);
    });
    await flushPromises();

    expect(container.textContent).toContain('Note not found');
    expect(container.textContent).not.toContain('Loading…');
  });
});
