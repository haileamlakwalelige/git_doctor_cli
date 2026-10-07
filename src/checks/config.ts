import type { Check, Finding, Severity } from '../types.js';

export interface UrlCredential {
  protocol: string;
  redactedUrl: string;
  severity: Severity;
}

const PROTOCOL_URL = /^([a-z][a-z0-9+.-]*):\/\/([^/@\s]+)@(.+)$/i;
const SCP_LIKE = /^([^/@\s]+)@([^/@\s]+):(.+)$/;
const SECRETISH_USER = /(token|secret|key|ghp|gho|ghu|ghs|ghr|github_pat|xox|sk)/i;

export function detectUrlCredential(url: string): UrlCredential | null {
  const match = PROTOCOL_URL.exec(url.trim());
  if (match) {
    const protocol = (match[1] ?? '').toLowerCase();
    const userinfo = match[2] ?? '';
    const hostAndPath = match[3] ?? '';
    if ((protocol === 'ssh' || protocol === 'git') && !userinfo.includes(':')) {
      return null;
    }
    const redactedUrl = protocol + '://***@' + hostAndPath;
    const hasPassword = userinfo.includes(':');
    const severity: Severity =
      hasPassword && (protocol === 'http' || protocol === 'https')
        ? 'critical'
        : hasPassword
          ? 'high'
          : protocol === 'http' || protocol === 'https'
            ? 'high'
            : 'medium';
    return { protocol, redactedUrl, severity };
  }

  const scp = SCP_LIKE.exec(url.trim());
  if (scp) {
    const user = scp[1] ?? '';
    if (user.length < 16 && !SECRETISH_USER.test(user)) return null;
    return {
      protocol: 'ssh',
      redactedUrl: '***@' + (scp[2] ?? '') + ':' + (scp[3] ?? ''),
      severity: 'high',
    };
  }

  return null;
}

async function missingIdentity(git: (args: string[]) => Promise<{ ok: boolean; stdout: string }>) {
  const result = await git(['config', '--get-regexp', '^user\\.(name|email)$']);
  const values = new Map<string, string>();
  if (result.ok) {
    for (const line of result.stdout.split('\n')) {
      const match = /^user\.(\S+)\s(.*)$/.exec(line);
      if (match?.[1]) values.set(match[1], (match[2] ?? '').trim());
    }
  }
  const missing: string[] = [];
  if (!values.get('name')) missing.push('user.name');
  if (!values.get('email')) missing.push('user.email');
  return { missing, emailMissing: missing.includes('user.email') };
}

export const configCheck: Check = {
  meta: {
    id: 'config',
    name: 'Configuration',
    description: 'Missing git identity, leaked credentials in remote URLs, missing remotes',
  },
  async run(ctx) {
    const findings: Finding[] = [];

    const identity = await missingIdentity(ctx.git);
    if (identity.missing.length > 0) {
      findings.push({
        id: 'git-identity',
        severity: identity.emailMissing ? 'high' : 'medium',
        title: 'Git identity is not configured (' + identity.missing.join(', ') + ' missing)',
        details: ['git refuses to create commits until these are set.'],
        actions: [
          {
            title: 'Set your identity',
            commands: [
              'git config --global user.name "Your Name"',
              'git config --global user.email "you@example.com"',
            ],
          },
        ],
        data: { missing: identity.missing },
      });
    }

    const remotes = await ctx.git(['remote']);
    const remoteNames = remotes.ok ? remotes.stdout.split('\n').filter(Boolean) : [];

    if (remoteNames.length === 0) {
      findings.push({
        id: 'no-remote',
        severity: 'info',
        title: 'No remote configured',
        details: ['This repository only exists on this machine - there is no backup.'],
        actions: [
          {
            title: 'Add a remote and push',
            commands: ['git remote add origin <url>', 'git push -u origin HEAD'],
          },
        ],
      });
      return findings;
    }

    const urlRegs = await Promise.all([
      ctx.git(['config', '--get-regexp', '^remote\\..*\\.url$']),
      ctx.git(['config', '--get-regexp', '^url\\..*\\.insteadof$']),
    ]);

    const flagged: { url: string; credential: UrlCredential }[] = [];
    for (const result of urlRegs) {
      if (!result.ok) continue;
      for (const line of result.stdout.split('\n')) {
        const space = line.indexOf(' ');
        const url = space === -1 ? '' : line.slice(space + 1).trim();
        if (!url) continue;
        const credential = detectUrlCredential(url);
        if (credential) flagged.push({ url, credential });
      }
    }

    if (flagged.length > 0) {
      const worst = flagged.some((entry) => entry.credential.severity === 'critical')
        ? 'critical'
        : 'high';
      findings.push({
        id: 'credential-in-remote',
        severity: worst,
        title:
          flagged.length === 1
            ? 'Remote URL contains an embedded credential'
            : flagged.length + ' remote URLs contain embedded credentials',
        details: [
          ...flagged.map((entry) => '- ' + entry.credential.redactedUrl),
          'Anyone who can read this repository (or a clone of it) can use these credentials.',
        ],
        actions: [
          {
            title: 'Remove the credentials from the remote URL',
            commands: [
              'git remote set-url origin <url-without-credentials>',
              'git config --global --unset-all credential.helper',
            ],
            note: 'Then rotate the exposed credential - it is stored in plain text in .git/config.',
          },
        ],
        data: { urls: flagged.map((entry) => entry.credential.redactedUrl) },
      });
    }

    return findings;
  },
};
