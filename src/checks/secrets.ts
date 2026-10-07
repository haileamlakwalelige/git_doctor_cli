import type { Check, Finding, Severity } from '../types.js';
import { spawnGit } from '../git.js';

export interface SecretPattern {
  id: string;
  label: string;
  severity: Severity;
  regex: RegExp;
}

export interface SecretMatch {
  pattern: SecretPattern;
  value: string;
}

export interface SecretHit {
  patternId: string;
  label: string;
  severity: Severity;
  value: string;
  sha: string;
  file: string | null;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'aws-access-key', label: 'AWS access key ID', severity: 'critical', regex: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { id: 'github-token', label: 'GitHub token', severity: 'critical', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { id: 'slack-token', label: 'Slack token', severity: 'critical', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'openai-key', label: 'OpenAI/Anthropic API key', severity: 'critical', regex: /\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-key', label: 'Google API key', severity: 'critical', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'stripe-key', label: 'Stripe API key', severity: 'critical', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { id: 'npm-token', label: 'npm token', severity: 'critical', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'private-key', label: 'Private key block', severity: 'critical', regex: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g },
  {
    id: 'generic-credential',
    label: 'possible embedded credential',
    severity: 'medium',
    regex: /\b(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|access[_-]?key|client[_-]?secret|auth[_-]?token|credential)s?\b\s*[:=]\s*(?:"([^"]{8,})"|'([^']{8,})'|([^\s"'`]{8,}))/gi,
  },
];

const CANDIDATE = new RegExp(
  [
    'AKIA|ASIA|ABIA|ACCA',
    'gh[pousr]_|github_pat_',
    'xox[baprs]-',
    'sk[_-]',
    'AIza',
    'npm_[A-Za-z0-9]',
    'BEGIN [A-Z0-9]* ?PRIVATE KEY',
    'secret|passw|token|api[_-]?key|credential|authorization|private[_-]?key',
  ].join('|'),
  'i',
);

const FAKE_VALUE =
  /^(?:x{4,}|\*{4,}|-{4,}|\.{4,}|<|>|\{\{|\$\{|your[_-]|example|placeholder|dummy|redacted|change[_-]?me|todo|fixme|xxx+|\d+$)/i;

export function isCandidate(line: string): boolean {
  return line.length >= 12 && CANDIDATE.test(line);
}

export function redact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '*'.repeat(Math.max(4, trimmed.length));
  return trimmed.slice(0, 6) + '*'.repeat(6) + ' (' + trimmed.length + ' chars)';
}

export function matchSecrets(line: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(line)) !== null) {
      const raw =
        pattern.id === 'generic-credential'
          ? (match[1] ?? match[2] ?? match[3] ?? '')
          : match[0];
      if (raw.length > 0 && (pattern.id !== 'generic-credential' || !FAKE_VALUE.test(raw))) {
        matches.push({ pattern, value: raw });
      }
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
    }
  }
  return matches;
}

function fileFromDiffLine(line: string): string | null {
  if (line.startsWith('+++ b/')) return line.slice(6).trim();
  if (line.startsWith('--- a/')) return line.slice(6).trim();
  if (line.startsWith('diff --git ')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    return match?.[2] ?? null;
  }
  return null;
}

export interface ScanResult {
  hits: SecretHit[];
  commitsScanned: number;
  error?: string;
}

const RECORD_SEPARATOR = String.fromCharCode(30);

export async function scanHistory(repoPath: string, limit: number): Promise<ScanResult> {
  const args = ['log', '-p', '--all', '--no-color', '--no-show-signature', '--format=%x1e%H'];
  if (limit > 0) args.push('-n' + String(limit));

  return new Promise((resolve) => {
    const child = spawnGit(args, repoPath);
    const hits: SecretHit[] = [];
    let commitsScanned = 0;
    let stderr = '';
    let buffer = '';
    let file: string | null = null;
    let settled = false;

    const processRecord = (part: string) => {
      const newline = part.indexOf('\n');
      if (newline === -1) return;
      const sha = part.slice(0, newline).trim();
      commitsScanned += 1;
      const body = part.slice(newline + 1);
      file = null;
      for (const line of body.split('\n')) {
        if (line.startsWith('diff --git ') || line.startsWith('+++ ') || line.startsWith('--- ')) {
          const nextFile = fileFromDiffLine(line);
          if (nextFile) file = nextFile;
          continue;
        }
        if (!isCandidate(line)) continue;
        for (const match of matchSecrets(line)) {
          hits.push({
            patternId: match.pattern.id,
            label: match.pattern.label,
            severity: match.pattern.severity,
            value: match.value,
            sha,
            file,
          });
        }
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (buffer.length > 0) processRecord(buffer);
      buffer = '';
      resolve({ hits, commitsScanned, error: stderr.trim() || undefined });
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', () => {
      stderr += 'failed to run git log';
      finish();
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(RECORD_SEPARATOR);
      buffer = parts.pop() ?? '';
      for (const part of parts) processRecord(part);
    });

    child.stdout.on('end', finish);
    child.on('close', finish);
  });
}

interface GroupedSecret {
  patternId: string;
  label: string;
  severity: Severity;
  value: string;
  occurrences: number;
  firstSha: string;
  file: string | null;
}

function groupHits(hits: SecretHit[]): GroupedSecret[] {
  const groups = new Map<string, GroupedSecret>();
  for (const hit of hits) {
    const key = hit.patternId + ' ' + hit.value;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      groups.set(key, {
        patternId: hit.patternId,
        label: hit.label,
        severity: hit.severity,
        value: hit.value,
        occurrences: 1,
        firstSha: hit.sha,
        file: hit.file,
      });
    }
  }
  return [...groups.values()];
}

function describe(grouped: GroupedSecret): string {
  const location = grouped.file ? ', ' + grouped.file : '';
  const count = grouped.occurrences > 1 ? grouped.occurrences + ' occurrences, ' : '';
  return (
    '- ' + grouped.label + ': ' + redact(grouped.value) +
    ' (' + count + 'first in ' + grouped.firstSha.slice(0, 8) + location + ')'
  );
}

function secretData(groups: GroupedSecret[]): Record<string, unknown>[] {
  return groups.map((group) => ({
    label: group.label,
    redacted: redact(group.value),
    occurrences: group.occurrences,
    firstCommit: group.firstSha,
    file: group.file,
  }));
}

export const secretsCheck: Check = {
  meta: {
    id: 'secrets',
    name: 'Secrets in history',
    description: 'Credentials and private keys committed at some point in history',
  },
  async run(ctx) {
    const limit = ctx.options.history;
    const result = await scanHistory(ctx.repoPath, limit);
    if (result.hits.length === 0) {
      const error = result.error ?? '';
      const emptyRepo = /does not have any commits|unknown revision|bad revision/.test(error);
      if (result.commitsScanned === 0 && error.includes('fatal:') && !emptyRepo) {
        throw new Error(error.split('\n')[0]);
      }
      return [];
    }

    const grouped = groupHits(result.hits);
    const critical = grouped.filter((group) => group.severity === 'critical');
    const criticalValues = new Set(critical.map((group) => group.value));
    const possible = grouped.filter(
      (group) => group.severity !== 'critical' && !criticalValues.has(group.value),
    );
    const scope =
      limit > 0
        ? 'Scanned the last ' + result.commitsScanned + ' commits.'
        : 'Scanned all ' + result.commitsScanned + ' commits.';

    const findings: Finding[] = [];

    if (critical.length > 0) {
      findings.push({
        id: 'secrets-in-history',
        severity: 'critical',
        title:
          critical.length + ' secret' + (critical.length === 1 ? '' : 's') + ' detected in previous commits',
        details: [...critical.slice(0, 8).map(describe), scope],
        actions: [
          {
            title:
              'Rotate ' + (critical.length === 1 ? 'the exposed credential' : 'the exposed credentials'),
            note: 'Revoke and regenerate them in the provider dashboard first - treat them as compromised.',
          },
          {
            title: 'Purge the values from history',
            commands: ['git filter-repo --replace-text expressions.txt', 'git push --force'],
            note: 'Rewrites history: coordinate with collaborators. Rotation is what actually protects you.',
          },
        ],
        data: { count: critical.length, secrets: secretData(critical) },
      });
    }

    if (possible.length > 0) {
      findings.push({
        id: 'possible-credentials',
        severity: 'medium',
        title:
          possible.length +
          ' possible credential' +
          (possible.length === 1 ? '' : 's') +
          ' in previous commits',
        details: [
          ...possible.slice(0, 6).map(describe),
          scope,
          'No known token format matched - review these by hand.',
        ],
        actions: [
          {
            title: 'Verify the flagged values are not real credentials',
            note: 'Move real secrets into environment variables or a secret manager.',
          },
        ],
        data: { count: possible.length, secrets: secretData(possible) },
      });
    }

    return findings;
  },
};
