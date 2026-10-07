import type { Check, Finding, GitResult } from '../types.js';

const COMMIT_LINE = /^(dangling|unreachable) commit ([0-9a-f]{40})$/;

function uniqueShas(stdout: string): string[] {
  const shas = new Set<string>();
  for (const line of stdout.split('\n')) {
    const match = COMMIT_LINE.exec(line.trim());
    if (match?.[2]) shas.add(match[2]);
  }
  return [...shas];
}

async function committerTimes(git: (args: string[]) => Promise<GitResult>, shas: string[]): Promise<number[]> {
  if (shas.length === 0) return [];
  const result = await git(['show', '-s', '--format=%ct', ...shas]);
  if (!result.ok) return shas.map(() => 0);
  return result.stdout
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

function plural(count: number, singular: string, suffix = 's'): string {
  return count === 1 ? singular : `${singular}${suffix}`;
}

export async function findDanglingCommits(
  git: (args: string[]) => Promise<GitResult>,
): Promise<{ shas: string[]; error?: string }> {
  const result = await git(['fsck', '--no-progress', '--no-reflogs', '--unreachable', '--dangling']);
  if (!result.ok) return { shas: [], error: result.stderr.trim().split('\n')[0] ?? 'git fsck failed' };
  return { shas: uniqueShas(result.stdout) };
}

export const danglingCheck: Check = {
  meta: {
    id: 'dangling',
    name: 'Dangling commits',
    description: 'Commits that are no longer reachable from any branch (lost work)',
  },
  async run(ctx) {
    const { shas, error } = await findDanglingCommits(ctx.git);
    if (error && shas.length === 0) throw new Error(error);
    if (shas.length === 0) return [];

    const samples = shas.slice(0, 5);
    const times = await committerTimes(ctx.git, samples);
    const now = Math.floor(Date.now() / 1000);
    const newest = Math.max(...times, 0);
    const ageDays = newest > 0 ? Math.floor((now - newest) / 86_400) : null;
    const recent = ageDays !== null && ageDays <= 14;

    const details = [
      `Sample: ${samples.map((sha) => sha.slice(0, 8)).join(', ')}`,
      ageDays !== null
        ? `Newest lost commit was created ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}.`
        : undefined,
      'These commits are unreachable from every branch; reflogs normally keep them alive for about 90 days.',
    ].filter((line): line is string => line !== undefined);

    const findings: Finding[] = [
      {
        id: 'dangling-commits',
        severity: recent ? 'high' : 'medium',
        title: `${shas.length} dangling ${plural(shas.length, 'commit')} found`,
        details,
        actions: [
          {
            title: `Inspect the ${shas.length} dangling ${plural(shas.length, 'commit')}`,
            commands: ['git fsck --lost-found', 'git show <sha>'],
          },
          {
            title: 'Rescue the ones you want onto a branch',
            commands: ['git branch recovered/<sha> <sha>'],
          },
        ],
        data: { count: shas.length, samples },
      },
    ];
    return findings;
  },
};
