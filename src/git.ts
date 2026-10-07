import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

export interface RunOptions {
  maxBuffer?: number;
}

export async function runGit(args: string[], cwd: string, opts: RunOptions = {}): Promise<import('./types.js').GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...BASE_ARGS, ...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: opts.maxBuffer ?? 128 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const errno = error as NodeJS.ErrnoException;
          const code = typeof errno.code === 'number' ? errno.code : 1;
          resolve({ ok: false, stdout: stdout ?? '', stderr: stderr || error.message, code });
        } else {
          resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '', code: 0 });
        }
      },
    );
  });
}

export function spawnGit(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn('git', [...BASE_ARGS, ...args], { cwd, windowsHide: true });
}

export async function isGitInstalled(): Promise<boolean> {
  const result = await runGit(['--version'], process.cwd());
  return result.ok;
}

export function gitFailureMessage(result: import('./types.js').GitResult): string {
  const firstLine = result.stderr.trim().split('\n')[0] ?? '';
  return firstLine || `git exited with code ${result.code}`;
}
