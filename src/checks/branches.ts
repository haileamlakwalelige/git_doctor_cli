import type { Check, CheckContext, Finding } from '../types.js';

interface BranchInfo {
  name: string;
  sha: string;
  committedAt: number;
  upstream: string;
  track: string;
  current: boolean;
}

const PRIMARY_FALLBACK = new Set(['main', 'master', 'develop', 'development', 'trunk', 'dev']);

const FIELD_SEPARATOR = '\t';

function parseBranches(stdout: string): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split(FIELD_SEPARATOR);
    const name = parts[0] ?? '';
    if (name.length === 0) continue;
    branches.push({
      name,
      sha: parts[1] ?? '',
      committedAt: Number.parseInt(parts[2] ?? '0', 10) || 0,
      upstream: parts[3] ?? '',
      track: parts[4] ?? '',
      current: (parts[5] ?? '').trim() === '*',
    });
  }
  return branches;
}

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return 'unknown date';
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function ageInDays(unixSeconds: number): number {
  return Math.floor((Date.now() / 1000 - unixSeconds) / 86_400);
}

function listNames(names: string[], limit = 8): string {
  const shown = names.slice(0, limit).join(', ');
  const rest = names.length - Math.min(names.length, limit);
  return rest > 0 ? `${shown} …and ${rest} more` : shown;
}

async function defaultBranchNames(ctx: CheckContext): Promise<Set<string>> {
  const names = new Set<string>(PRIMARY_FALLBACK);
  const originHead = await ctx.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok) {
    const ref = originHead.stdout.trim();
    const short = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
    if (short) names.add(short);
  }
  return names;
}

export const branchesCheck: Check = {
  meta: {
    id: 'branches',
    name: 'Branches',
    description: 'Unmerged work, stale merged branches, branches tracking deleted remotes',
  },
  async run(ctx) {
    const findings: Finding[] = [];
    const format = [
      '%(refname:short)',
      '%(objectname)',
      '%(committerdate:unix)',
      '%(upstream:short)',
      '%(upstream:track)',
      '%(HEAD)',
    ].join(FIELD_SEPARATOR);

    const refs = await ctx.git(['for-each-ref', `--format=${format}`, 'refs/heads']);
    if (!refs.ok) throw new Error(refs.stderr.trim().split('\n')[0] ?? 'git for-each-ref failed');
    const branches = parseBranches(refs.stdout);
    if (branches.length === 0) return findings;

    const mergedResult = await ctx.git(['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads']);
    const merged = new Set(mergedResult.ok ? mergedResult.stdout.split('\n').filter(Boolean) : []);

    const current = branches.find((branch) => branch.current);
    const unmerged = branches.filter(
      (branch) => !branch.current && !merged.has(branch.name),
    );

    if (unmerged.length > 0) {
      const currentName = current?.name ?? 'HEAD';
      findings.push({
        id: 'unmerged-branches',
        severity: 'medium',
        title: `${unmerged.length} ${unmerged.length === 1 ? 'branch contains' : 'branches contain'} unmerged work`,
        details: [
          listNames(unmerged.map((branch) => branch.name)),
          `Not reachable from ${currentName}. Review with: git log ${currentName}..<branch>`,
        ],
        actions: [
          {
            title: `Review and merge or delete ${unmerged.length} ${unmerged.length === 1 ? 'branch' : 'branches'}`,
            commands: [
              `git log --oneline ${currentName}..<branch>`,
              'git branch -d <branch>',
            ],
          },
        ],
        data: { branches: unmerged.map((branch) => branch.name) },
      });
    }

    const primaryNames = await defaultBranchNames(ctx);
    const stale = branches.filter(
      (branch) =>
        !branch.current &&
        merged.has(branch.name) &&
        !primaryNames.has(branch.name) &&
        branch.committedAt > 0 &&
        ageInDays(branch.committedAt) > ctx.options.staleDays,
    );

    if (stale.length > 0) {
      findings.push({
        id: 'stale-branches',
        severity: 'low',
        title: `${stale.length} stale ${stale.length === 1 ? 'branch' : 'branches'} (merged, inactive for ${ctx.options.staleDays}+ days)`,
        details: [
          listNames(
            stale.map(
              (branch) => `${branch.name} — last commit ${formatDate(branch.committedAt)}`,
            ),
          ),
          'All of these are already merged into the current branch, so deleting them loses nothing.',
        ],
        actions: [
          {
            title: `Clean ${stale.length} stale ${stale.length === 1 ? 'branch' : 'branches'}`,
            commands: [`git branch -d ${stale.map((branch) => branch.name).join(' ')}`],
          },
        ],
        data: { branches: stale.map((branch) => branch.name) },
      });
    }

    const gone = branches.filter((branch) => branch.track.includes('[gone]'));
    if (gone.length > 0) {
      const goneMerged = gone.filter((branch) => merged.has(branch.name));
      const commands = ['git fetch --prune'];
      if (goneMerged.length > 0) {
        commands.push(`git branch -d ${goneMerged.map((branch) => branch.name).join(' ')}`);
      }
      findings.push({
        id: 'gone-upstream-branches',
        severity: 'low',
        title: `${gone.length} ${gone.length === 1 ? 'branch tracks' : 'branches track'} remote ${gone.length === 1 ? 'branch' : 'branches'} that no longer exist`,
        details: [listNames(gone.map((branch) => `${branch.name} → ${branch.upstream}`))],
        actions: [
          {
            title: `Prune ${gone.length} stale remote-tracking ${gone.length === 1 ? 'reference' : 'references'}`,
            commands,
          },
        ],
        data: { branches: gone.map((branch) => branch.name) },
      });
    }

    if (current && !current.upstream && !ctx.bare) {
      findings.push({
        id: 'no-upstream',
        severity: 'low',
        title: `Branch '${current.name}' has no upstream`,
        details: ['git pull and git push need an upstream to know where to push.'],
        actions: [
          {
            title: `Set an upstream for '${current.name}'`,
            commands: [`git push -u origin ${current.name}`],
          },
        ],
      });
    }

    return findings;
  },
};
