import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { GitDoctorError, diagnose } from '../src/diagnose.js';
import {
  findingValues,
  globToRegExp,
  isIgnored,
  loadIgnoreRules,
  parseIgnoreRules,
} from '../src/ignore.js';
import { renderText } from '../src/report.js';
import type { Finding } from '../src/types.js';
import {
  cleanupTempDirs,
  commitAll,
  findingIds,
  initRepo,
  tempDir,
  writeFile,
} from './helpers.js';

afterAll(() => cleanupTempDirs());

const TOKEN = 'ghp_' + 'Zx9K2mP4qR7sT1vU3wX5yB6cD8eF0gH1';

function finding(data?: Finding['data']): Finding {
  return { id: 'sample', severity: 'medium', title: 'sample', data };
}

describe('ignore rules', () => {
  it('skips comments and blank lines', () => {
    const rules = parseIgnoreRules(['', '  ', '# a comment', 'secrets']);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.check).toBe('secrets');
    expect(rules[0]?.pattern).toBeNull();
  });

  it('parses whole-check, scoped and plain glob rules', () => {
    const rules = parseIgnoreRules(['secrets', 'large-files:**/*.psd', 'test/**']);
    expect(rules[0]).toMatchObject({ check: 'secrets', pattern: null, regex: null });
    expect(rules[1]?.check).toBe('large-files');
    expect(rules[1]?.regex?.test('assets/big.psd')).toBe(true);
    expect(rules[2]?.check).toBeNull();
    expect(rules[2]?.regex?.test('test/a.ts')).toBe(true);
  });

  it('rejects a typo in the check name instead of ignoring nothing', () => {
    expect(() => parseIgnoreRules(['secret:test/**'], '.gitdoctorignore')).toThrow(GitDoctorError);
    expect(() => parseIgnoreRules(['secret:test/**'], '.gitdoctorignore')).toThrow(/Unknown check/);
  });

  it('treats a colon that is not a check id as a glob', () => {
    const rules = parseIgnoreRules(['docs/*:latest/**']);
    expect(rules[0]?.check).toBeNull();
    expect(rules[0]?.regex?.test('docs/*:latest/v1')).toBe(true);
  });

  it('matches globs the way gitignore users expect', () => {
    expect(globToRegExp('test/**').test('test/secrets.test.ts')).toBe(true);
    expect(globToRegExp('test/**').test('src/test.ts')).toBe(false);
    expect(globToRegExp('**/*.psd').test('big.psd')).toBe(true);
    expect(globToRegExp('**/*.psd').test('assets/deep/big.psd')).toBe(true);
    expect(globToRegExp('test\\**').test('test/a.ts')).toBe(true);
    expect(globToRegExp('?.txt').test('a.txt')).toBe(true);
    expect(globToRegExp('?.txt').test('ab.txt')).toBe(false);
  });

  it('collects nested strings from finding data', () => {
    const values = findingValues(
      finding({ files: ['a.txt'], secrets: [{ file: 'b.txt', redacted: 'xx******' }] }),
    );
    expect(values).toContain('a.txt');
    expect(values).toContain('b.txt');
    expect(values).toContain('xx******');
  });

  it('applies rules to the right check and path', () => {
    const scoped = parseIgnoreRules(['secrets:test/**']);
    const inTests = finding({ secrets: [{ file: 'test/fixture.ts' }] });
    const inSrc = finding({ secrets: [{ file: 'src/config.ts' }] });
    expect(isIgnored(inTests, 'secrets', scoped)).toBe(true);
    expect(isIgnored(inSrc, 'secrets', scoped)).toBe(false);
    expect(isIgnored(inTests, 'large-files', scoped)).toBe(false);

    const wholeCheck = parseIgnoreRules(['stash']);
    expect(isIgnored(finding({ count: 3 }), 'stash', wholeCheck)).toBe(true);
    expect(isIgnored(finding({ count: 3 }), 'sync', wholeCheck)).toBe(false);

    expect(isIgnored(inTests, 'secrets', [])).toBe(false);
  });

  it('reads the ignore file from the repository, or none at all', () => {
    const dir = join(process.cwd(), 'test', 'does-not-exist');
    expect(loadIgnoreRules(dir)).toEqual({ rules: [], source: null });
    expect(loadIgnoreRules(dir, { ignoreFile: null })).toEqual({ rules: [], source: null });
    expect(loadIgnoreRules(dir, { ignore: ['secrets'] })).toMatchObject({
      rules: [{ check: 'secrets' }],
      source: 'options',
    });
  });
});

describe('ignore integration', () => {
  it('hides accepted findings and reports how many were hidden', async () => {
    const repo = makeFixtureRepo();

    const report = await diagnose(repo);
    expect(report.ignored?.count).toBe(1);
    expect(report.ignored?.source?.endsWith('.gitdoctorignore')).toBe(true);
    expect(findingIds(report)).not.toContain('secrets-in-history');
    expect(report.checks.find((check) => check.check === 'secrets')?.status).toBe('ok');
    expect(renderText(report, { color: false, verbose: false })).toMatch(
      /1 finding hidden by .*\.gitdoctorignore/,
    );

    const unfiltered = await diagnose(repo, { ignoreFile: null });
    expect(findingIds(unfiltered)).toContain('secrets-in-history');
    expect(unfiltered.ignored).toEqual({ count: 0, source: null });

    const inline = await diagnose(repo, { ignore: ['secrets'] });
    expect(findingIds(inline)).not.toContain('secrets-in-history');
    expect(inline.ignored?.source).toBe('options');
  });
});

function makeFixtureRepo(): string {
  const repo = tempDir('git-doctor-ignore-');
  initRepo(repo);
  writeFile(repo, 'test/secret.ts', 'const token = "' + TOKEN + '";\n');
  writeFile(repo, 'src/app.ts', 'export const app = 1;\n');
  writeFile(repo, '.gitdoctorignore', '# fixtures are expected\nsecrets:test/**\n');
  commitAll(repo, 'add fixtures');
  return repo;
}
