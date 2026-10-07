import type { Check, Finding } from '../types.js';

export const stashCheck: Check = {
  meta: {
    id: 'stash',
    name: 'Stashes',
    description: 'Stashed changes that may have been forgotten',
  },
  async run(ctx) {
    const result = await ctx.git(['stash', 'list', '--format=%gd%x09%ci%x09%s']);
    if (!result.ok) return [];
    const lines = result.stdout.split('\n').filter((line) => line.length > 0);
    if (lines.length === 0) return [];

    const entries = lines.slice(0, 5).map((line) => {
      const [name = '', date = '', subject = ''] = line.split('\t');
      const day = date.slice(0, 10);
      return '- ' + name + (day ? ' (' + day + ')' : '') + (subject ? ': ' + subject : '');
    });
    if (lines.length > 5) entries.push('- ...and ' + (lines.length - 5) + ' more');

    const findings: Finding[] = [
      {
        id: 'stashed-changes',
        severity: 'info',
        title: lines.length + ' stash entr' + (lines.length === 1 ? 'y' : 'ies') + ' found',
        details: entries,
        actions: [
          {
            title: 'Review and drop or restore the stashes',
            commands: ['git stash list', 'git stash pop', 'git stash drop'],
            note: 'Stashes live only on this machine - they are never pushed.',
          },
        ],
        data: { count: lines.length },
      },
    ];
    return findings;
  },
};
