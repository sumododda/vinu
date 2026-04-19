import { spawn } from 'node:child_process';

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs an external program with explicit arguments.
 * Uses spawn (NOT exec) and never opens a shell, so arguments cannot be
 * interpreted as shell metacharacters. This is the safe wrapper for sidecar
 * binaries (whisper, ffmpeg).
 */
export function runProcess(
  command: string,
  args: string[],
  opts?: { signal?: AbortSignal; cwd?: string },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts?.cwd,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));

    const onAbort = () => child.kill('SIGTERM');
    opts?.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      opts?.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      opts?.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve({ code: 0, stdout, stderr });
      else reject(new Error(stderr || `process exited with code ${code}`));
    });
  });
}
