import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
