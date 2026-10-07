import { afterAll, describe, expect, it } from 'vitest';
import { randomFillSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnose } from '../src/diagnose.js';
import { renderText } from '../src/report.js';
import { cleanupTempDirs, commitAll, findFinding, git, initRepo, tempDir, writeFile } from './helpers.js';

afterAll(() => {
  cleanupTempDirs();
});

const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';

describe('history checks', () => {
  it('detects a secret committed in history and never prints it', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'src/config.js', "const token = '" + GITHUB_TOKEN + "';\n");
    commitAll(dir, 'add config');

    const report = await diagnose(dir, { checks: ['secrets'] });
    const finding = findFinding(report, 'secrets-in-history');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('critical');
    expect(finding?.title).toContain('secret');

    expect(JSON.stringify(report)).not.toContain(GITHUB_TOKEN);
    const output = renderText(report, { color: false, verbose: false });
    expect(output).not.toContain(GITHUB_TOKEN);
    expect(output).toContain('Rotate');
  });

  it('ignores placeholder credentials', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, '.env', 'API_KEY=your-api-key-here\nPASSWORD=xxxxxxxxxxxx\n');
    commitAll(dir, 'add env');

    const report = await diagnose(dir, { checks: ['secrets'] });
    expect(findFinding(report, 'possible-credentials')).toBeUndefined();
  });

  it('detects large files in history', async () => {
    const dir = tempDir();
    initRepo(dir);
    const payload = Buffer.alloc(600 * 1024);
    randomFillSync(payload);
    writeFileSync(join(dir, 'model.bin'), payload);
    commitAll(dir, 'add model');

    const report = await diagnose(dir, { checks: ['large-files'], maxFileSizeMB: 0.5 });
    const finding = findFinding(report, 'large-files');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.title).toContain('model.bin');
  });

  it('accepts a higher size threshold without complaining', async () => {
    const dir = tempDir();
    initRepo(dir);
    const payload = Buffer.alloc(600 * 1024);
    randomFillSync(payload);
    writeFileSync(join(dir, 'model.bin'), payload);
    commitAll(dir, 'add model');

    const report = await diagnose(dir, { checks: ['large-files'], maxFileSizeMB: 50 });
    expect(report.findings).toHaveLength(0);
  });

  it('detects tracked files that .gitignore also matches', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, '.env', 'API_KEY=abc123secret99\n');
    commitAll(dir, 'add env');
    writeFile(dir, '.gitignore', '.env\n');

    const report = await diagnose(dir, { checks: ['ignored-tracked'] });
    const finding = findFinding(report, 'ignored-but-tracked');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.details?.join(' ')).toContain('.env');
  });

  it('detects stale merged branches and unmerged work', async () => {
    const dir = tempDir();
    initRepo(dir);
    const old = new Date(Date.now() - 150 * 86_400_000).toISOString();
    writeFile(dir, 'old.txt', 'old');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'old work'], {
      GIT_AUTHOR_DATE: old,
      GIT_COMMITTER_DATE: old,
    });
    git(dir, ['branch', 'stale-branch']);

    writeFile(dir, 'new.txt', 'new');
    commitAll(dir, 'new work');

    git(dir, ['switch', '-c', 'feature']);
    writeFile(dir, 'feature.txt', 'feature');
    commitAll(dir, 'feature work');
    git(dir, ['switch', 'main']);

    const report = await diagnose(dir, { checks: ['branches'], staleDays: 90 });
    const stale = findFinding(report, 'stale-branches');
    expect(stale).toBeDefined();
    expect(stale?.data?.branches).toContain('stale-branch');

    const unmerged = findFinding(report, 'unmerged-branches');
    expect(unmerged).toBeDefined();
    expect(unmerged?.data?.branches).toContain('feature');
    expect(unmerged?.severity).toBe('medium');
  });

  it('reports forgotten stashes', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'a.txt', 'a');
    commitAll(dir, 'first');
    writeFile(dir, 'a.txt', 'a\nwork in progress');
    git(dir, ['stash', 'push', '-m', 'wip']);

    const report = await diagnose(dir, { checks: ['stash'] });
    const finding = findFinding(report, 'stashed-changes');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('info');
    expect(finding?.details?.join(' ')).toContain('wip');
  });

  it('runs every check against a repository with many problems', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFile(dir, 'src/config.js', "const token = '" + GITHUB_TOKEN + "';\n");
    commitAll(dir, 'add config');
    writeFile(dir, '.env', 'API_KEY=abc123secret99\n');
    commitAll(dir, 'add env');
    writeFile(dir, '.gitignore', '.env\n');
    const tree = git(dir, ['rev-parse', 'HEAD^{tree}']).trim();
    git(dir, ['commit-tree', tree, '-m', 'orphan']);

    const report = await diagnose(dir);
    expect(report.checks).toHaveLength(10);
    expect(report.checks.every((check) => check.status !== 'failed')).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(GITHUB_TOKEN);
  });
});
