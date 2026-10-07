import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { diagnose, GitDoctorError } from '../src/diagnose.js';
import { exitCodeFor, renderText } from '../src/report.js';
import {
  cleanupTempDirs,
  commitAll,
  findFinding,
  git,
  initRepo,
  tempDir,
  writeFile,
} from './helpers.js';

afterAll(() => {
  cleanupTempDirs();
});

const ANSI = String.fromCharCode(27) + '[';

describe('diagnose', () => {
  it('rejects directories that are not repositories', async () => {
    const dir = tempDir();
    await expect(diagnose(dir)).rejects.toThrow(GitDoctorError);
    await expect(diagnose(dir)).rejects.toThrow(/Not a git repository/);
  });

  it('rejects missing directories', async () => {
    await expect(diagnose(join(tempDir(), 'nope'))).rejects.toThrow(/No such directory/);
  });

  it('reports an unborn branch on an empty repository', async () => {
    const dir = tempDir();
    initRepo(dir);
    const report = await diagnose(dir);
    expect(findFinding(report, 'unborn-head')).toBeDefined();
    expect(report.checks.every((check) => check.status !== 'failed')).toBe(true);
  });

  it('detects a detached HEAD', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');
    git(dir, ['switch', '--detach', 'HEAD']);

    const report = await diagnose(dir, { checks: ['repo'] });
    const finding = findFinding(report, 'detached-head');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.actions?.length).toBeGreaterThan(0);
  });

  it('detects an unfinished merge with conflicts', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'file.txt', 'base\n');
    commitAll(dir, 'base');
    git(dir, ['switch', '-c', 'other']);
    writeFile(dir, 'file.txt', 'theirs\n');
    commitAll(dir, 'theirs');
    git(dir, ['switch', 'main']);
    writeFile(dir, 'file.txt', 'ours\n');
    commitAll(dir, 'ours');
    git(dir, ['merge', 'other'], {}, true);

    const report = await diagnose(dir, { checks: ['repo'] });
    const finding = report.findings.find((item) => item.id.startsWith('in-progress-MERGE_HEAD'));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(findFinding(report, 'unmerged-files')).toBeUndefined();
  });

  it('detects dangling commits', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');
    const tree = git(dir, ['rev-parse', 'HEAD^{tree}']).trim();
    const orphan = git(dir, ['commit-tree', tree, '-m', 'work that was never referenced']).trim();
    expect(orphan).toMatch(/^[0-9a-f]{40}$/);

    const report = await diagnose(dir, { checks: ['dangling'] });
    const finding = findFinding(report, 'dangling-commits');
    expect(finding).toBeDefined();
    expect(finding?.data?.count).toBe(1);
    expect(finding?.title).toContain('dangling');
  });

  it('reports a branch that is behind its upstream', async () => {
    const remote = tempDir('git-doctor-remote-');
    git(remote, ['init', '--bare', '-b', 'main']);

    const work = tempDir();
    initRepo(work);
    writeFile(work, 'a.txt', 'a');
    commitAll(work, 'first');
    git(work, ['remote', 'add', 'origin', remote]);
    git(work, ['push', '-u', 'origin', 'main']);

    const other = tempDir('git-doctor-clone-');
    git(other, ['clone', remote, other]);
    git(other, ['config', 'user.name', 'Test User']);
    git(other, ['config', 'user.email', 'test@example.com']);
    git(other, ['config', 'commit.gpgsign', 'false']);
    writeFile(other, 'b.txt', 'b');
    commitAll(other, 'second');
    git(other, ['push', 'origin', 'main']);

    git(work, ['fetch']);

    const report = await diagnose(work, { checks: ['sync'] });
    const finding = findFinding(report, 'behind-upstream');
    expect(finding).toBeDefined();
    expect(finding?.title).toContain('behind');
    expect(finding?.severity).toBe('medium');
  });

  it('detects credentials embedded in a remote URL', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');
    git(dir, [
      'remote',
      'add',
      'origin',
      'https://ghp_abc123def456ghi789jkl012@github.com/user/repo.git',
    ]);

    const report = await diagnose(dir, { checks: ['config'] });
    const finding = findFinding(report, 'credential-in-remote');
    expect(finding).toBeDefined();
    expect(['high', 'critical']).toContain(finding?.severity);
    expect(JSON.stringify(finding)).not.toContain('ghp_abc123def456ghi789jkl012');
  });

  it('detects a missing git identity', async () => {
    const dir = tempDir();
    initRepo(dir, false);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');

    const emptyConfig = join(tempDir('git-doctor-cfg-'), 'empty.gitconfig');
    writeFileSync(emptyConfig, '');
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_CONFIG_GLOBAL = emptyConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const report = await diagnose(dir, { checks: ['config'] });
      const finding = findFinding(report, 'git-identity');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.title).toContain('user.email');
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      if (previousSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = previousSystem;
    }
  });

  it('keeps exit codes calm for low-risk repositories', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');

    const report = await diagnose(dir);
    expect(report.checks.every((check) => check.status !== 'failed')).toBe(true);
    expect(exitCodeFor(report, 'high')).toBe(0);
    expect(exitCodeFor(report, 'low')).toBe(1);
    expect(exitCodeFor(report, 'never')).toBe(0);
  });

  it('rejects unknown check names', async () => {
    const dir = tempDir();
    initRepo(dir);
    await expect(diagnose(dir, { checks: ['nope'] })).rejects.toThrow(/Unknown check/);
    await expect(diagnose(dir, { skip: ['nope'] })).rejects.toThrow(/Unknown check/);
  });
});

describe('rendering', () => {
  it('produces color-free output when color is disabled', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');
    const report = await diagnose(dir, { checks: ['config'] });
    const output = renderText(report, { color: false, verbose: false });
    expect(output.includes(ANSI)).toBe(false);
    expect(output).toContain('Recommended actions');
  });
});
