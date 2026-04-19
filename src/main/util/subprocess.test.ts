import { describe, it, expect } from 'vitest';
import { runProcess } from './subprocess';

describe('runProcess', () => {
  it('resolves with stdout for exit code 0', async () => {
    const r = await runProcess(process.execPath, ['-e', "process.stdout.write('hi')"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('hi');
  });

  it('rejects with stderr for non-zero exit', async () => {
    await expect(
      runProcess(process.execPath, ['-e', "process.stderr.write('boom'); process.exit(2)"]),
    ).rejects.toThrow(/boom/);
  });
});
