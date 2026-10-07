import type { Check, Finding } from '../types.js';

function plural(count: number, word: string): string {
  return count + ' ' + word + (count === 1 ? '' : 's');
}

const NUL = String.fromCharCode(0);

export interface StatusEntry {
  flag: string;
  path: string;
}

export function parseSubmoduleStatus(stdout: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 42) continue;
    const flag = (line[0] ?? ' ').trim() || ' ';
    let rest = line.slice(41).trim();
    const paren = rest.lastIndexOf(' (');
    if (paren !== -1 && rest.endsWith(')')) rest = rest.slice(0, paren);
    if (rest.length > 0) entries.push({ flag, path: rest });
  }
  return entries;
}

async function gitlinkPaths(
  git: (args: string[]) => Promise<{ ok: boolean; stdout: string }>,
): Promise<string[]> {
  const result = await git(['ls-files', '--stage']);
  if (!result.ok) return [];
  const paths: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('160000 ')) {
      const tab = line.indexOf('\t');
      if (tab !== -1) paths.push(line.slice(tab + 1));
    }
  }
  return paths;
}

async function declaredPaths(
  git: (args: string[]) => Promise<{ ok: boolean; stdout: string }>,
): Promise<string[]> {
  const result = await git(['config', '-z', '--get-regexp', '^submodule\\..*\\.path$']);
  if (!result.ok) return [];
  const parts = result.stdout.split(NUL);
  const paths: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const value = parts[i];
    if (value) paths.push(value);
  }
  return paths;
}

export const submodulesCheck: Check = {
  meta: {
    id: 'submodules',
    name: 'Submodules',
    description: 'Uninitialized, out-of-date or broken submodule entries',
  },
  async run(ctx) {
    const findings: Finding[] = [];
    const status = await ctx.git(['submodule', 'status']);

    if (status.ok) {
      const entries = parseSubmoduleStatus(status.stdout);
      const uninitialized = entries.filter((entry) => entry.flag === '-').map((entry) => entry.path);
      const mismatched = entries.filter((entry) => entry.flag === '+').map((entry) => entry.path);
      const conflicted = entries.filter((entry) => entry.flag === 'U').map((entry) => entry.path);

      if (uninitialized.length > 0) {
        findings.push({
          id: 'submodules-uninitialized',
          severity: 'medium',
          title: plural(uninitialized.length, 'submodule') + ' not initialized',
          details: ['Missing locally: ' + uninitialized.join(', ')],
          actions: [
            {
              title: 'Initialize the submodules',
              commands: ['git submodule update --init --recursive'],
            },
          ],
          data: { paths: uninitialized },
        });
      }

      if (mismatched.length > 0) {
        findings.push({
          id: 'submodules-out-of-date',
          severity: 'medium',
          title: plural(mismatched.length, 'submodule') + ' at a different commit than recorded',
          details: [
            mismatched.join(', '),
            'The checked-out submodule commit does not match what this repository records.',
          ],
          actions: [
            {
              title: 'Sync the submodules to the recorded commits',
              commands: ['git submodule update --recursive'],
            },
          ],
          data: { paths: mismatched },
        });
      }

      if (conflicted.length > 0) {
        findings.push({
          id: 'submodules-conflicted',
          severity: 'high',
          title: plural(conflicted.length, 'submodule') + ' has unresolved conflicts',
          details: [conflicted.join(', ')],
          actions: [
            {
              title: 'Resolve the submodule conflicts',
              commands: [
                'cd <submodule> && git checkout <commit>',
                'git add <submodule>',
              ],
            },
          ],
          data: { paths: conflicted },
        });
      }
    }

    const results = await Promise.all([gitlinkPaths(ctx.git), declaredPaths(ctx.git)]);
    const gitlinks = results[0];
    const declared = new Set(results[1]);
    const orphaned = gitlinks.filter((path) => !declared.has(path));

    if (orphaned.length > 0) {
      findings.push({
        id: 'submodules-undeclared',
        severity: 'medium',
        title: plural(orphaned.length, 'gitlink') + ' recorded without a .gitmodules entry',
        details: [
          orphaned.join(', '),
          'Git treats these as submodules but has no URL to fetch them from.',
        ],
        actions: [
          {
            title: 'Declare or remove the gitlinks',
            commands: [
              'git submodule add <url> ' + orphaned[0],
              'git rm --cached ' + orphaned[0],
            ],
          },
        ],
        data: { paths: orphaned },
      });
    }

    return findings;
  },
};
