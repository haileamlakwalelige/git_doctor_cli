import { describe, expect, it } from 'vitest';
import { exitCodeFor, renderText } from '../src/report.js';
import type { CheckResult, Finding, Report } from '../src/types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'example',
    severity: 'medium',
    title: 'Example finding',
    ...overrides,
  };
}

function makeReport(findings: Finding[], checks: CheckResult[] = []): Report {
  return {
    tool: 'git-doctor',
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    repoPath: '/repo',
    gitDir: '/repo/.git',
    bare: false,
    head: { branch: 'main', sha: 'abcdef1234567890', detached: false },
    checks:
      checks.length > 0
        ? checks
        : [
            {
              check: 'repo',
              name: 'Repository state',
              status: findings.length > 0 ? 'findings' : 'ok',
              durationMs: 10,
              findings,
            },
          ],
    findings,
    durationMs: 1234,
  };
}

describe('renderText', () => {
  it('prints every finding with its details', () => {
    const report = makeReport([
      makeFinding({ id: 'a', severity: 'critical', title: 'Secret found', details: ['in src/key.ts'] }),
      makeFinding({ id: 'b', severity: 'info', title: 'Just a note' }),
    ]);
    const output = renderText(report, { color: false, verbose: false });
    expect(output).toContain('Secret found');
    expect(output).toContain('in src/key.ts');
    expect(output).toContain('Just a note');
    expect(output).toContain('Git Doctor v0.1.0');
    expect(output).toContain('/repo');
    expect(output).toContain('main');
  });

  it('orders findings from most to least severe', () => {
    const report = makeReport([
      makeFinding({ id: 'low', severity: 'low', title: 'LOW FINDING' }),
      makeFinding({ id: 'crit', severity: 'critical', title: 'CRITICAL FINDING' }),
      makeFinding({ id: 'info', severity: 'info', title: 'INFO FINDING' }),
    ]);
    const output = renderText(report, { color: false, verbose: false });
    expect(output.indexOf('CRITICAL FINDING')).toBeLessThan(output.indexOf('LOW FINDING'));
    expect(output.indexOf('LOW FINDING')).toBeLessThan(output.indexOf('INFO FINDING'));
  });

  it('lists recommended actions without duplicates', () => {
    const report = makeReport([
      makeFinding({
        id: 'a',
        title: 'One',
        actions: [{ title: 'Fix it', commands: ['git fix'] }],
      }),
      makeFinding({
        id: 'b',
        title: 'Two',
        actions: [{ title: 'Fix it', commands: ['git fix'] }, { title: 'Do other thing' }],
      }),
    ]);
    const output = renderText(report, { color: false, verbose: false });
    expect(output).toContain('Recommended actions');
    expect(output.match(/Fix it/g)).toHaveLength(1);
    expect(output).toContain('Do other thing');
    expect(output).toContain('git fix');
  });

  it('emits no ANSI escapes when color is disabled', () => {
    const report = makeReport([makeFinding({ severity: 'critical', title: 'Bad thing' })]);
    const output = renderText(report, { color: false, verbose: false });
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\u001b\[/);
  });

  it('reports failed checks', () => {
    const report = makeReport([], [
      { check: 'secrets', name: 'Secrets', status: 'failed', durationMs: 5, findings: [], error: 'boom' },
    ]);
    const output = renderText(report, { color: false, verbose: false });
    expect(output).toContain('secrets');
    expect(output).toContain('boom');
  });

  it('shows passing checks only in verbose mode', () => {
    const checks: CheckResult[] = [
      { check: 'stash', name: 'Stashes', status: 'ok', durationMs: 3, findings: [] },
    ];
    const quiet = renderText(makeReport([], checks), { color: false, verbose: false });
    const verbose = renderText(makeReport([], checks), { color: false, verbose: true });
    expect(quiet).not.toContain('stash');
    expect(verbose).toContain('stash');
    expect(verbose).toContain('Checks');
  });
});

describe('exitCodeFor', () => {
  it('returns 0 when nothing meets the threshold', () => {
    const report = makeReport([makeFinding({ severity: 'medium' })]);
    expect(exitCodeFor(report, 'high')).toBe(0);
    expect(exitCodeFor(report, 'medium')).toBe(1);
  });

  it('returns 1 when a finding meets the threshold', () => {
    const report = makeReport([makeFinding({ severity: 'critical' })]);
    expect(exitCodeFor(report, 'high')).toBe(1);
  });

  it('returns 0 when fail-on is never', () => {
    const report = makeReport([makeFinding({ severity: 'critical' })]);
    expect(exitCodeFor(report, 'never')).toBe(0);
  });

  it('returns 2 when a check failed', () => {
    const report = makeReport([], [
      { check: 'repo', name: 'Repository state', status: 'failed', durationMs: 1, findings: [], error: 'x' },
    ]);
    expect(exitCodeFor(report, 'high')).toBe(2);
  });
});
