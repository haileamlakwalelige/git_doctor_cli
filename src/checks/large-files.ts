import type { Check, Finding } from '../types.js';
import { spawnGit } from '../git.js';

interface LargeBlob {
  sha: string;
  path: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function parseBatchCheckLine(line: string): LargeBlob | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  const firstSpace = trimmed.indexOf(' ');
  const secondSpace = trimmed.indexOf(' ', firstSpace + 1);
  if (firstSpace === -1 || secondSpace === -1) return undefined;
  const sha = trimmed.slice(0, firstSpace);
  const type = trimmed.slice(firstSpace + 1, secondSpace);
  const rest = trimmed.slice(secondSpace + 1);
  const sizeSpace = rest.indexOf(' ');
  if (type !== 'blob' || sizeSpace === -1) return undefined;
  const size = Number.parseInt(rest.slice(0, sizeSpace), 10);
  const path = rest.slice(sizeSpace + 1).trim();
  if (!Number.isFinite(size)) return undefined;
  return { sha, path: path.length > 0 ? path : '(unnamed blob)', size };
}

export function scanLargeBlobs(
  repoPath: string,
  thresholdBytes: number,
  onBlob?: (blob: LargeBlob) => void,
): Promise<LargeBlob[]> {
  return new Promise((resolve, reject) => {
    const lister = spawnGit(['rev-list', '--objects', '--all'], repoPath);
    const checker = spawnGit(
      ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize) %(rest)'],
      repoPath,
    );

    const blobs: LargeBlob[] = [];
    const seen = new Set<string>();
    let stderr = '';
    let settled = false;
    let listerCode: number | null = null;
    let checkerCode: number | null = null;

    const maybeFinish = () => {
      if (settled || listerCode === null || checkerCode === null) return;
      settled = true;
      if (listerCode === 0 && checkerCode === 0) {
        resolve(blobs);
      } else {
        reject(new Error(stderr.trim().split('\n')[0] ?? `git exited with code ${listerCode || checkerCode}`));
      }
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    lister.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    checker.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    checker.stdin.on('error', () => {
      stderr += 'broken pipe while listing objects\n';
    });

    let buffer = '';
    checker.stdout.setEncoding('utf8');
    checker.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const blob = parseBatchCheckLine(line);
        if (blob && blob.size >= thresholdBytes && !seen.has(blob.sha)) {
          seen.add(blob.sha);
          blobs.push(blob);
          onBlob?.(blob);
        }
        index = buffer.indexOf('\n');
      }
    });

    lister.stdout.pipe(checker.stdin);

    lister.on('error', fail);
    checker.on('error', fail);
    lister.on('close', (code) => {
      listerCode = code ?? 1;
      maybeFinish();
    });
    checker.on('close', (code) => {
      checkerCode = code ?? 1;
      maybeFinish();
    });
  });
}

export const largeFilesCheck: Check = {
  meta: {
    id: 'large-files',
    name: 'Large files in history',
    description: 'Oversized blobs stored anywhere in the repository history',
  },
  async run(ctx) {
    const thresholdBytes = Math.max(1, Math.round(ctx.options.maxFileSizeMB * 1024 * 1024));
    const blobs = await scanLargeBlobs(ctx.repoPath, thresholdBytes);
    if (blobs.length === 0) return [];

    blobs.sort((a, b) => b.size - a.size);
    const top = blobs.slice(0, 10);
    const limit = ctx.options.maxFileSizeMB;
    const findings: Finding[] = [
      {
        id: 'large-files',
        severity: 'high',
        title:
          top.length === 1
            ? `1 large file detected: ${top[0]!.path} (${formatSize(top[0]!.size)})`
            : `${blobs.length} large files detected (largest: ${top[0]!.path} (${formatSize(top[0]!.size)}))`,
        details: [
          ...top.map((blob) => `• ${blob.path} — ${formatSize(blob.size)} (${blob.sha.slice(0, 8)})`),
          `Threshold: ${limit} MB. Every clone downloads these forever.`,
        ],
        actions: [
          {
            title: `Remove ${top.length === 1 ? 'the large file' : `${top.length} large files`} from history`,
            commands: [
              'pip install git-filter-repo',
              `git filter-repo --path ${top[0]!.path} --invert-paths`,
              'git push --force',
            ],
            note: 'Rewrites history: everyone must re-clone, so coordinate first.',
          },
        ],
        data: {
          count: blobs.length,
          files: top.map((blob) => ({ path: blob.path, size: blob.size, sha: blob.sha })),
        },
      },
    ];
    return findings;
  },
};
