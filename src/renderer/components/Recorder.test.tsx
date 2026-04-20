// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from './Recorder';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    notes: {
      create: vi.fn(),
    },
    onHotkey: vi.fn(() => () => {}),
  },
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
}));

class MediaRecorderMock {
  static instances: MediaRecorderMock[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;
  state: 'inactive' | 'recording' = 'inactive';

  constructor(
    public stream: MediaStream,
    public options: { mimeType: string },
  ) {
    MediaRecorderMock.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    void this.onstop?.();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMediaStreamMock() {
  const stop = vi.fn();
  const track = { stop };
  return {
    stream: {
      getTracks: () => [track],
    } as unknown as MediaStream,
    stop,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Recorder', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    MediaRecorderMock.instances = [];
    mockApi.notes.create.mockReset();
    mockApi.notes.create.mockResolvedValue({ id: 'note-1' });
    mockApi.onHotkey.mockClear();
    getUserMedia = vi.fn();
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal('MediaRecorder', MediaRecorderMock);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('blocks re-entrant starts before setup resolves', async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);

    await act(async () => {
      root.render(<Recorder onCreated={vi.fn()} />);
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
      button!.click();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(button!.textContent).toBe('Starting…');

    const { stream } = createMediaStreamMock();
    pending.resolve(stream);
    await flushPromises();
  });

  it('stops the acquired stream when setup fails after permission succeeds', async () => {
    const { stream, stop } = createMediaStreamMock();
    getUserMedia.mockResolvedValue(stream);

    const boom = new Error('unsupported mime type');
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw boom;
        }
      },
    );

    await act(async () => {
      root.render(<Recorder onCreated={vi.fn()} />);
    });

    await act(async () => {
      container.querySelector('button')!.click();
    });
    await flushPromises();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('unsupported mime type');
  });

  it('saves on stop and cleans up the active stream once', async () => {
    const { stream, stop } = createMediaStreamMock();
    getUserMedia.mockResolvedValue(stream);
    const onCreated = vi.fn();

    await act(async () => {
      root.render(<Recorder onCreated={onCreated} />);
    });

    await act(async () => {
      container.querySelector('button')!.click();
    });
    await flushPromises();

    const recorder = MediaRecorderMock.instances[0];
    expect(recorder).toBeDefined();

    await act(async () => {
      recorder.ondataavailable?.({ data: new Blob(['audio']) });
      container.querySelector('button')!.click();
    });
    await flushPromises();

    expect(mockApi.notes.create).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith('note-1');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')!.textContent).toBe('● Record');
  });
});
