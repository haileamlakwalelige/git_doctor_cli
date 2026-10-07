import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Finding } from '../src/types.js';

const tempDirs: string[] = [];

export function tempDir(prefix = 'git-doctor-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baseEnv: NodeJS.ProcessEnv = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export function git(
  cwd: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  allowFailure = false,
): string {
  const options: ExecFileSyncOptions = {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...baseEnv, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  try {
    return execFileSync('git', args, options) as unknown as string;
  } catch (error) {
    if (allowFailure) {
      const failure = error as { stdout?: string; stderr?: string };
      return String(failure.stdout ?? '') + String(failure.stderr ?? '');
    }
    throw error;
  }
}

export function initRepo(dir: string, withIdentity = true): void {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'tag.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  if (withIdentity) {
    git(dir, ['config', 'user.name', 'Test User']);
    git(dir, ['config', 'user.email', 'test@example.com']);
  }
}

export function writeFile(dir: string, relativePath: string, content: string): string {
  const target = join(dir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

export function commitAll(dir: string, message: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message], extraEnv);
}

export function findFinding(report: { findings: Finding[] }, id: string): Finding | undefined {
  return report.findings.find((finding) => finding.id === id);
}

export function findingIds(report: { findings: Finding[] }): string[] {
  return report.findings.map((finding) => finding.id);
}
