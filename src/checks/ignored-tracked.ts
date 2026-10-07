import type { Check, Finding } from '../types.js';

const SECRETISH_FILE =
  /(^|\/)(\.env|\.netrc|\.npmrc|\.pgpass|credentials?|secrets?|id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.[^/]*)?$|\.(pem|key|p12|pfx|jks|keystore)$/i;

const NUL = String.fromCharCode(0);

function listFiles(files: string[], limit = 8): string {
  const shown = files.slice(0, limit).join(', ');
  const rest = files.length - Math.min(files.length, limit);
  return rest > 0 ? shown + ' ...and ' + rest + ' more' : shown;
}

function quote(file: string): string {
  return /\s/.test(file) ? '"' + file + '"' : file;
}

export const ignoredTrackedCheck: Check = {
  meta: {
    id: 'ignored-tracked',
    name: 'Tracked but ignored files',
    description: 'Files that are committed yet matched by .gitignore',
  },
  async run(ctx) {
    if (ctx.bare) return [];
    const result = await ctx.git(['ls-files', '-i', '-c', '--exclude-standard', '-z']);
    if (!result.ok) throw new Error(result.stderr.trim().split('\n')[0] ?? 'git ls-files failed');

    const files = result.stdout.split(NUL).filter((file) => file.length > 0);
    if (files.length === 0) return [];

    const risky = files.filter((file) => SECRETISH_FILE.test(file));
    const severity = risky.length > 0 ? 'high' : 'medium';
    const findings: Finding[] = [
      {
        id: 'ignored-but-tracked',
        severity,
        title:
          files.length +
          ' tracked file' +
          (files.length === 1 ? ' is' : 's are') +
          ' also matched by .gitignore',
        details: [
          listFiles(files),
          risky.length > 0
            ? 'Sensitive-looking paths among them: ' + listFiles(risky)
            : 'gitignore only affects untracked files - these are already committed.',
        ],
        actions: [
          {
            title: 'Stop tracking ' + (risky.length > 0 ? 'the sensitive files' : 'these files'),
            commands: ['git rm --cached ' + files.slice(0, 5).map(quote).join(' ')],
            note: 'Keeps your local copies on disk and removes them from the repository on the next commit.',
          },
        ],
        data: { files, risky },
      },
    ];
    return findings;
  },
};
