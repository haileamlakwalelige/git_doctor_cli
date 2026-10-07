import type { Check, Finding } from '../types.js';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const syncCheck: Check = {
  meta: {
    id: 'sync',
    name: 'Sync with upstream',
    description: 'Branches that are ahead of or behind their upstream',
  },
  async run(ctx) {
    const symbolic = await ctx.git(['symbolic-ref', '-q', '--short', 'HEAD']);
    if (!symbolic.ok) return [];
    const branch = symbolic.stdout.trim();
    if (!branch) return [];

    const upstream = await ctx.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!upstream.ok) return [];

    const upstreamName = upstream.stdout.trim();
    const counts = await ctx.git(['rev-list', '--left-right', '--count', `HEAD...${upstreamName}`]);
    if (!counts.ok) return [];

    const [aheadText, behindText] = counts.stdout.trim().split(/\s+/);
    const ahead = Number.parseInt(aheadText ?? '0', 10) || 0;
    const behind = Number.parseInt(behindText ?? '0', 10) || 0;

    const findings: Finding[] = [];

    if (behind > 0) {
      findings.push({
        id: 'behind-upstream',
        severity: 'medium',
        title: `Branch '${branch}' is ${plural(behind, 'commit')} behind '${upstreamName}'`,
        details: [
          ahead > 0
            ? `'${branch}' and '${upstreamName}' have diverged: ${ahead} local, ${behind} remote commits.`
            : `Update with a fast-forward pull when your working tree is clean.`,
        ],
        actions: [
          {
            title: `Fast-forward '${branch}' to '${upstreamName}'`,
            commands: ['git pull --ff-only'],
          },
        ],
        data: { branch, upstream: upstreamName, ahead, behind },
      });
    }

    if (ahead > 0) {
      findings.push({
        id: 'ahead-upstream',
        severity: 'medium',
        title: `Branch '${branch}' has ${plural(ahead, 'commit')} that ${ahead === 1 ? 'is' : 'are'} not pushed`,
        details: [
          `Only '${branch}' has them — a disk failure or a rebase here would lose this work.`,
        ],
        actions: [
          {
            title: `Push ${plural(ahead, 'commit')} to '${upstreamName}'`,
            commands: ['git push'],
          },
        ],
        data: { branch, upstream: upstreamName, ahead },
      });
    }

    return findings;
  },
};
