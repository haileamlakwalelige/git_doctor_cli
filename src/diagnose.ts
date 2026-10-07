import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import type {
  CheckContext,
  CheckResult,
  DiagnoseOptions,
  HeadInfo,
  Report,
  ResolvedOptions,
} from './types.js';
import { SEVERITY_RANK } from './types.js';
import { runGit } from './git.js';
import { ALL_CHECKS } from './checks/index.js';
import { isIgnored, loadIgnoreRules } from './ignore.js';
import { GitDoctorError } from './errors.js';
import { VERSION } from './version.js';

export { GitDoctorError } from './errors.js';

export const DEFAULT_OPTIONS: ResolvedOptions = {
  history: 200,
  maxFileSizeMB: 50,
  staleDays: 90,
};

function selectChecks(options: DiagnoseOptions) {
  let selected = ALL_CHECKS;
  if (options.checks && options.checks.length > 0) {
    const unknown = options.checks.filter((id) => !ALL_CHECKS.some((check) => check.meta.id === id));
    if (unknown.length > 0) {
      throw new GitDoctorError(
        'Unknown check' + (unknown.length === 1 ? '' : 's') + ': ' + unknown.join(', ') +
          '. Available: ' + ALL_CHECKS.map((check) => check.meta.id).join(', '),
      );
    }
    selected = selected.filter((check) => options.checks!.includes(check.meta.id));
  }
  if (options.skip && options.skip.length > 0) {
    const unknown = options.skip.filter((id) => !ALL_CHECKS.some((check) => check.meta.id === id));
    if (unknown.length > 0) {
      throw new GitDoctorError(
        'Unknown check' + (unknown.length === 1 ? '' : 's') + ' in --skip: ' + unknown.join(', '),
      );
    }
    selected = selected.filter((check) => !options.skip!.includes(check.meta.id));
  }
  if (selected.length === 0) {
    throw new GitDoctorError('No checks selected.');
  }
  return selected;
}

async function probeRepo(repoPath: string): Promise<{ gitDir: string; bare: boolean }> {
  let exists = true;
  try {
    statSync(repoPath);
  } catch {
    exists = false;
  }
  if (!exists) throw new GitDoctorError('No such directory: ' + repoPath);

  const gitDir = await runGit(['rev-parse', '--absolute-git-dir'], repoPath);
  if (!gitDir.ok) {
    const message = gitDir.stderr.trim().split('\n')[0] ?? '';
    if (message.includes('not a git repository')) {
      throw new GitDoctorError('Not a git repository: ' + repoPath);
    }
    if (message.toLowerCase().includes('cannot run') || gitDir.code === 127) {
      throw new GitDoctorError('git is not installed or not on PATH.');
    }
    throw new GitDoctorError(message || 'git rev-parse failed.');
  }

  const bareProbe = await runGit(['rev-parse', '--is-bare-repository'], repoPath);
  return { gitDir: gitDir.stdout.trim(), bare: bareProbe.ok && bareProbe.stdout.trim() === 'true' };
}

async function readHead(repoPath: string): Promise<HeadInfo> {
  const [symbolic, verify] = await Promise.all([
    runGit(['symbolic-ref', '-q', '--short', 'HEAD'], repoPath),
    runGit(['rev-parse', '-q', '--verify', 'HEAD'], repoPath),
  ]);
  const branch = symbolic.ok ? symbolic.stdout.trim() || null : null;
  const sha = verify.ok ? verify.stdout.trim() || null : null;
  return { branch, sha, detached: branch === null && sha !== null };
}

export async function diagnose(
  repoPath: string = process.cwd(),
  options: DiagnoseOptions = {},
): Promise<Report> {
  const startedAt = Date.now();
  const target = resolve(repoPath);
  const selected = selectChecks(options);
  const probe = await probeRepo(target);
  const head = await readHead(target);

  const resolved: ResolvedOptions = {
    history: options.history ?? DEFAULT_OPTIONS.history,
    maxFileSizeMB: options.maxFileSizeMB ?? DEFAULT_OPTIONS.maxFileSizeMB,
    staleDays: options.staleDays ?? DEFAULT_OPTIONS.staleDays,
  };

  const ctx: CheckContext = {
    repoPath: target,
    gitDir: probe.gitDir,
    bare: probe.bare,
    head,
    options: resolved,
    git: (args) => runGit(args, target),
  };

  const results: CheckResult[] = await Promise.all(
    selected.map(async (check) => {
      const checkStarted = Date.now();
      try {
        const findings = await check.run(ctx);
        return {
          check: check.meta.id,
          name: check.meta.name,
          status: findings.length > 0 ? 'findings' : 'ok',
          durationMs: Date.now() - checkStarted,
          findings,
        } satisfies CheckResult;
      } catch (error) {
        return {
          check: check.meta.id,
          name: check.meta.name,
          status: 'failed' as const,
          durationMs: Date.now() - checkStarted,
          findings: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const ignore = loadIgnoreRules(target, options);
  let ignoredCount = 0;
  for (const result of results) {
    if (result.findings.length === 0) continue;
    const kept = result.findings.filter((finding) => {
      if (!isIgnored(finding, result.check, ignore.rules)) return true;
      ignoredCount++;
      return false;
    });
    if (kept.length !== result.findings.length) {
      result.findings = kept;
      if (result.status === 'findings') result.status = 'ok';
    }
  }

  const order = new Map(selected.map((check, index) => [check.meta.id, index]));
  const pairs = results.flatMap((result) =>
    result.findings.map((finding) => ({ finding, checkId: result.check })),
  );
  pairs.sort((a, b) => {
    const severity = SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity];
    if (severity !== 0) return severity;
    return (order.get(a.checkId) ?? 0) - (order.get(b.checkId) ?? 0);
  });

  return {
    tool: 'git-doctor',
    version: VERSION,
    generatedAt: new Date().toISOString(),
    repoPath: target,
    gitDir: probe.gitDir,
    bare: probe.bare,
    head,
    checks: results,
    findings: pairs.map((pair) => pair.finding),
    ignored: { count: ignoredCount, source: ignore.source },
    durationMs: Date.now() - startedAt,
  };
}
