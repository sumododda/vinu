import { test, expect, _electron as electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('record → transcribe → llm (faked) → ready', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      VINU_LLM_FAKE: '1',
    },
  });

  const win = await app.firstWindow();
  await win.waitForSelector('text=vinu');

  const audio = readFileSync(join(__dirname, 'fixtures/short.webm'));
  const id = await win.evaluate(async (audioBytes) => {
    const buf = new Uint8Array(audioBytes).buffer;
    const r = await window.api.notes.create({ audio: buf, durationMs: 2000 });
    return r.id;
  }, [...audio]);
  expect(id).toBeTruthy();

  await expect.poll(async () => {
    const note = await win.evaluate((nid) => window.api.notes.get(nid), id);
    return note?.status;
  }, { timeout: 30_000 }).toBe('ready');

  await app.close();
});
