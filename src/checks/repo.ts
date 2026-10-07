import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, Finding, GitResult } from '../types.js';

interface Operation {
  marker: string;
  title: string;
  commands: string[];
  severity: 'high' | 'medium';
}

const OPERATIONS: Operation[] = [
  { marker: 'rebase-merge', title: 'An interactive rebase is in progress', commands: ['git rebase --continue', 'git rebase --abort'], severity: 'high' },
  { marker: 'rebase-apply', title: 'A rebase (or git am) is in progress', commands: ['git rebase --continue', 'git rebase --abort'], severity: 'high' },
  { marker: 'MERGE_HEAD', title: 'A merge is in progress', commands: ['git merge --continue', 'git merge --abort'], severity: 'high' },
  { marker: 'CHERRY_PICK_HEAD', title: 'A cherry-pick is in progress', commands: ['git cherry-pick --continue', 'git cherry-pick --abort'], severity: 'high' },
  { marker: 'REVERT_HEAD', title: 'A revert is in progress', commands: ['git revert --continue', 'git revert --abort'], severity: 'high' },
  { marker: 'sequencer', title: 'A multi-commit sequence (cherry-pick/revert) is in progress', commands: ['git cherry-pick --continue', 'git cherry-pick --quit'], severity: 'high' },
  { marker: 'BISECT_LOG', title: 'A bisect session is in progress', commands: ['git bisect reset'], severity: 'medium' },
];

async function unmergedPaths(git: (args: string[]) => Promise<GitResult>): Promise<string[]> {
  const result = await git(['ls-files', '--unmerged']);
  if (!result.ok) return [];
  const paths = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab !== -1) paths.add(line.slice(tab + 1));
  }
  return [...paths];
}

function summarizeList(items: string[], limit = 6): string {
  const shown = items.slice(0, limit).join(', ');
  const rest = items.length - Math.min(items.length, limit);
  return rest > 0 ? `${shown} …and ${rest} more` : shown;
}

export const repoCheck: Check = {
  meta: {
    id: 'repo',
    name: 'Repository state',
    description: 'Detached HEAD, in-progress operations, unresolved conflicts, uncommitted changes',
  },
  async run(ctx) {
    const findings: Finding[] = [];
    const [symbolic, verify] = await Promise.all([
      ctx.git(['symbolic-ref', '-q', '--short', 'HEAD']),
      ctx.git(['rev-parse', '-q', '--verify', 'HEAD']),
    ]);

    if (!symbolic.ok) {
      if (verify.ok) {
        const sha = verify.stdout.trim();
        const nameRev = await ctx.git(['name-rev', '--name-only', 'HEAD']);
        const ref = nameRev.ok ? nameRev.stdout.trim() : '';
        const location = ref && ref !== 'undefined' ? ` (${ref})` : '';
        findings.push({
          id: 'detached-head',
          severity: 'high',
          title: `HEAD is detached at ${sha.slice(0, 8)}${location}`,
          details: [
            'Commits made while detached are not on any branch and are easy to lose.',
          ],
          actions: [
            {
              title: 'Keep the current commits on a branch',
              commands: [`git switch -c <new-branch>`],
            },
            {
              title: 'Or return to the branch you detached from',
              commands: ['git switch <branch>'],
            },
          ],
          data: { sha },
        });
      } else {
        findings.push({
          id: 'unborn-head',
          severity: 'info',
          title: 'Repository has no commits yet',
          details: ['HEAD points at a branch that does not exist yet (unborn branch).'],
        });
      }
    }

    const unmerged = await unmergedPaths(ctx.git);
    let operationFinding: Finding | undefined;

    for (const op of OPERATIONS) {
      if (!existsSync(join(ctx.gitDir, op.marker))) continue;
      const details: string[] = [];
      if (unmerged.length > 0) {
        details.push(
          `${unmerged.length} file${unmerged.length === 1 ? '' : 's'} still conflicted: ${summarizeList(unmerged)}`,
        );
      }
      details.push('The repository is in a half-finished state until this is continued or aborted.');
      operationFinding = {
        id: `in-progress-${op.marker}`,
        severity: op.severity,
        title: op.title,
        details,
        actions: [
          { title: `Finish the ${op.title.replace(/^A(n)? /, '').replace(/ is in progress$/, '')}`, commands: [op.commands[0]!] },
          { title: 'Or cancel it and return to the previous state', commands: [op.commands[1]!] },
        ],
      };
      findings.push(operationFinding);
      break;
    }

    if (unmerged.length > 0 && !operationFinding) {
      findings.push({
        id: 'unmerged-files',
        severity: 'high',
        title: `${unmerged.length} file${unmerged.length === 1 ? '' : 's'} have unresolved merge conflicts`,
        details: [summarizeList(unmerged)],
        actions: [
          { title: 'Resolve the conflicted files, then stage them', commands: ['git add <file>', 'git commit'] },
          { title: 'Or abort and return to the pre-merge state', commands: ['git merge --abort'] },
        ],
      });
    }

    if (!ctx.bare) {
      const status = await ctx.git(['status', '--porcelain']);
      if (status.ok) {
        const lines = status.stdout.split('\n').filter((line) => line.length > 0);
        if (lines.length > 0) {
          let staged = 0;
          let unstaged = 0;
          let untracked = 0;
          for (const line of lines) {
            if (line.startsWith('??')) untracked += 1;
            else {
              if (line[0] !== ' ' && line[0] !== undefined) staged += 1;
              if (line[1] !== ' ' && line[1] !== undefined) unstaged += 1;
            }
          }
          findings.push({
            id: 'dirty-worktree',
            severity: 'info',
            title: `Working tree has ${lines.length} uncommitted change${lines.length === 1 ? '' : 's'}`,
            details: [
              `${staged} staged, ${unstaged} unstaged, ${untracked} untracked`,
            ],
          });
        }
      }
    }

    return findings;
  },
};
