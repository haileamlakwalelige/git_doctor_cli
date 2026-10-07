import pc from 'picocolors';
import type { Finding, RecommendedAction, Report, Severity } from './types.js';
import { SEVERITIES, SEVERITY_RANK } from './types.js';

export interface RenderOptions {
  color: boolean;
  verbose: boolean;
}

const ICONS: Record<Severity, string> = {
  critical: '✖',
  high: '▲',
  medium: '⚠',
  low: '•',
  info: 'ℹ',
};

function paint(text: string, color: (value: string) => string, enabled: boolean): string {
  return enabled ? color(text) : text;
}

function severityLabel(severity: Severity, color: boolean): string {
  const icon = ICONS[severity];
  if (severity === 'critical' || severity === 'high') return paint(icon, pc.red, color);
  if (severity === 'medium') return paint(icon, pc.yellow, color);
  if (severity === 'low') return paint(icon, pc.yellow, color);
  return paint(icon, pc.cyan, color);
}

function headLine(report: Report, color: boolean): string {
  const parts: string[] = [];
  if (report.head.branch) parts.push('branch ' + report.head.branch);
  else if (report.head.detached) parts.push('detached HEAD');
  else parts.push('no commits yet');
  if (report.head.sha) parts.push(report.head.sha.slice(0, 8));
  if (report.bare) parts.push('bare');
  return (
    paint('Git Doctor', pc.bold, color) +
    ' v' +
    report.version +
    '\n' +
    paint(report.repoPath, pc.dim, color) +
    ' ' +
    paint('(' + parts.join(', ') + ')', pc.dim, color)
  );
}

function findingBlock(finding: Finding, color: boolean): string[] {
  const lines = ['  ' + severityLabel(finding.severity, color) + ' ' + finding.title];
  for (const detail of finding.details ?? []) {
    lines.push('      ' + paint(detail, pc.dim, color));
  }
  return lines;
}

function collectActions(findings: Finding[]): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    for (const action of finding.actions ?? []) {
      if (seen.has(action.title)) continue;
      seen.add(action.title);
      actions.push(action);
    }
  }
  return actions;
}

function actionBlock(actions: RecommendedAction[], color: boolean): string[] {
  if (actions.length === 0) return [];
  const lines = ['', paint('Recommended actions', pc.bold, color), ''];
  actions.forEach((action, index) => {
    lines.push('  ' + paint(String(index + 1) + '.', pc.bold, color) + ' ' + action.title);
    for (const command of action.commands ?? []) {
      lines.push('       ' + paint(command, pc.cyan, color));
    }
    if (action.note) {
      lines.push('       ' + paint(action.note, pc.dim, color));
    }
    lines.push('');
  });
  return lines;
}

function summaryLine(report: Report, color: boolean): string {
  const failures = report.checks.filter((check) => check.status === 'failed');
  const counts = new Map<Severity, number>();
  for (const finding of report.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const breakdown = (['critical', 'high', 'medium', 'low', 'info'] as Severity[])
    .filter((severity) => (counts.get(severity) ?? 0) > 0)
    .map((severity) => counts.get(severity) + ' ' + severity)
    .join(', ');

  const seconds = (report.durationMs / 1000).toFixed(2);
  const checks = report.checks.length + ' check' + (report.checks.length === 1 ? '' : 's');

  if (failures.length > 0) {
    return paint(
      failures.length + ' check' + (failures.length === 1 ? '' : 's') + ' failed in ' + seconds + 's',
      pc.red,
      color,
    );
  }
  if (report.findings.length === 0) {
    return paint(
      'No issues found - ' + checks + ' passed in ' + seconds + 's',
      pc.green,
      color,
    );
  }
  return (
    report.findings.length +
    ' finding' +
    (report.findings.length === 1 ? '' : 's') +
    ' (' +
    breakdown +
    ') from ' +
    checks +
    ' in ' +
    seconds +
    's'
  );
}

export function renderText(report: Report, options: RenderOptions): string {
  const color = options.color;
  const lines: string[] = [headLine(report, color)];
  const findings = sortFindings(report.findings);

  const failures = report.checks.filter((check) => check.status === 'failed');

  if (options.verbose) {
    lines.push('', paint('Checks', pc.bold, color));
    for (const check of report.checks) {
      const mark = check.status === 'failed' ? paint('✖', pc.red, color) : paint('✔', pc.green, color);
      lines.push(
        '  ' + mark + ' ' + check.check.padEnd(16) + paint(check.durationMs + 'ms', pc.dim, color),
      );
    }
  }

  if (findings.length > 0) {
    lines.push('');
    for (const finding of findings) {
      lines.push(...findingBlock(finding, color));
    }
  }

  if (failures.length > 0) {
    lines.push('', paint('Checks that failed', pc.bold, color));
    for (const failure of failures) {
      lines.push('  ' + paint('✖ ' + failure.check, pc.red, color) + ': ' + (failure.error ?? 'unknown error'));
    }
  }

  lines.push(...actionBlock(collectActions(findings), color));
  lines.push(paint(summaryLine(report, color), pc.bold, color));
  return lines.join('\n');
}

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function exitCodeFor(report: Report, failOn: string): number {
  if (report.checks.some((check) => check.status === 'failed')) return 2;
  if (failOn === 'never') return 0;
  const threshold = SEVERITIES.indexOf(failOn as Severity);
  if (threshold === -1) return 0;
  return report.findings.some((finding) => SEVERITIES.indexOf(finding.severity) <= threshold) ? 1 : 0;
}
