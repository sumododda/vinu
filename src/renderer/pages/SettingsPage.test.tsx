// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../lib/api';
import { SettingsPage } from './SettingsPage';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    settings: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    provider: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: '',
    model: 'claude-opus-4-7',
    hotkeyEnabled: true,
    hotkeyAccelerator: 'CommandOrControl+Shift+N',
    keepAudioDefault: false,
    ...overrides,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getTextInputByLabelText(container: HTMLElement, labelText: string) {
  const labels = Array.from(container.querySelectorAll('label'));
  const match = labels.find((label) => label.textContent?.includes(labelText));
  let input = match?.querySelector('input') ?? null;
  if (!input && match?.htmlFor) {
    input = container.querySelector<HTMLInputElement>(`input[id="${match.htmlFor}"]`);
  }

  if (!input) throw new Error(`Input not found for label: ${labelText}`);
  return input as HTMLInputElement;
}

function getButton(container: HTMLElement, label: string) {
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((button) => button.textContent === label);

  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

function getRadioByLabelText(container: HTMLElement, labelText: string) {
  const labels = Array.from(container.querySelectorAll('label'));
  const match = labels.find((label) => label.textContent?.includes(labelText));
  const input = match?.querySelector('input[type="radio"]');

  if (!input) throw new Error(`Radio not found for label: ${labelText}`);
  return input as HTMLInputElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SettingsPage', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockApi.settings.get.mockReset();
    mockApi.settings.set.mockReset();
    mockApi.settings.set.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('loads settings and saves the updated form state', async () => {
    mockApi.settings.get.mockResolvedValue(makeSettings());

    await act(async () => {
      root.render(<SettingsPage />);
    });
    await flushPromises();

    await act(async () => {
      getRadioByLabelText(container, 'openrouter').click();
    });

    const apiKey = getTextInputByLabelText(container, 'API key');
    await act(async () => {
      setInputValue(apiKey, 'sk-updated');
    });

    await act(async () => {
      getButton(container, 'Save changes').click();
    });
    await flushPromises();

    expect(mockApi.settings.set).toHaveBeenCalledWith(
      makeSettings({
        provider: 'openrouter',
        apiKey: 'sk-updated',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    );
    expect(container.textContent).toContain('Saved.');
  });

  it('renders a retryable load error when settings fail to load', async () => {
    mockApi.settings.get
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(makeSettings({ apiKey: 'after-retry' }));

    await act(async () => {
      root.render(<SettingsPage />);
    });
    await flushPromises();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('load failed');
    expect(container.textContent).not.toContain('Loading…');

    await act(async () => {
      getButton(container, 'Retry').click();
    });
    await flushPromises();

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(getTextInputByLabelText(container, 'API key').value).toBe('after-retry');
  });

  it('shows a visible save error and re-enables saving after rejection', async () => {
    mockApi.settings.get.mockResolvedValue(makeSettings());
    mockApi.settings.set.mockRejectedValue(new Error('save failed'));

    await act(async () => {
      root.render(<SettingsPage />);
    });
    await flushPromises();

    await act(async () => {
      getButton(container, 'Save changes').click();
    });
    await flushPromises();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('save failed');
    expect(getButton(container, 'Save changes').disabled).toBe(false);
  });

  it('clears the saved indicator when the form is edited after save', async () => {
    mockApi.settings.get.mockResolvedValue(makeSettings());

    await act(async () => {
      root.render(<SettingsPage />);
    });
    await flushPromises();

    const pendingSave = deferred<void>();
    mockApi.settings.set.mockReturnValueOnce(pendingSave.promise);

    await act(async () => {
      getButton(container, 'Save changes').click();
    });

    expect(getButton(container, 'Saving…').disabled).toBe(true);

    await act(async () => {
      pendingSave.resolve();
    });
    await flushPromises();

    expect(container.textContent).toContain('Saved.');

    const model = getTextInputByLabelText(container, 'Model');
    await act(async () => {
      setInputValue(model, 'claude-opus-4-8');
    });

    expect(container.textContent).not.toContain('Saved.');
  });
});
