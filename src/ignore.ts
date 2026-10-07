import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { CHECK_IDS } from './checks/index.js';
import { GitDoctorError } from './errors.js';
import type { Finding } from './types.js';

export const IGNORE_FILENAME = '.gitdoctorignore';

export interface IgnoreRule {
  check: string | null;
  pattern: string | null;
  regex: RegExp | null;
}

export interface IgnoreRules {
  rules: IgnoreRule[];
  source: string | null;
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let source = '';
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!;
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index++;
        if (normalized[index + 1] === '/') {
          index++;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + source + '$');
}

export function parseIgnoreRules(lines: string[], source = 'ignore rules'): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) return;

    const colon = line.indexOf(':');
    const prefix = colon === -1 ? null : line.slice(0, colon).trim();

    if (prefix !== null && CHECK_IDS.includes(prefix)) {
      const rest = line.slice(colon + 1).trim();
      if (rest.length === 0) {
        rules.push({ check: prefix, pattern: null, regex: null });
      } else {
        rules.push({ check: prefix, pattern: rest, regex: globToRegExp(rest) });
      }
      return;
    }

    if (CHECK_IDS.includes(line)) {
      rules.push({ check: line, pattern: null, regex: null });
      return;
    }

    if (prefix !== null && /^[a-z][a-z0-9-]*$/.test(prefix)) {
      throw new GitDoctorError(
        'Unknown check "' + prefix + '" in ' + source + ' (line ' + (index + 1) +
          '). Available: ' + CHECK_IDS.join(', '),
      );
    }

    rules.push({ check: null, pattern: line, regex: globToRegExp(line) });
  });
  return rules;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.length > 0) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

export function findingValues(finding: Finding): string[] {
  const out: string[] = [];
  collectStrings(finding.data, out);
  return out;
}

export function isIgnored(finding: Finding, checkId: string, rules: IgnoreRule[]): boolean {
  if (rules.length === 0) return false;
  let values: string[] | null = null;
  for (const rule of rules) {
    if (rule.check !== null && rule.check !== checkId) continue;
    if (rule.regex === null) return true;
    if (values === null) {
      values = findingValues(finding).map((value) => value.replace(/\\/g, '/'));
    }
    if (values.some((value) => rule.regex!.test(value))) return true;
  }
  return false;
}

export interface IgnoreSource {
  ignore?: string[];
  ignoreFile?: string | null;
}

export function loadIgnoreRules(repoPath: string, options: IgnoreSource = {}): IgnoreRules {
  if (options.ignore && options.ignore.length > 0) {
    return { rules: parseIgnoreRules(options.ignore, 'the ignore option'), source: 'options' };
  }
  if (options.ignoreFile === null) return { rules: [], source: null };

  const file = options.ignoreFile
    ? resolve(options.ignoreFile)
    : resolve(repoPath, IGNORE_FILENAME);
  if (!existsSync(file)) return { rules: [], source: null };

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new GitDoctorError('Cannot read ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  }
  const rel = relative(repoPath, file);
  const display = rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
  return { rules: parseIgnoreRules(text.split(/\r?\n/), file), source: display };
}
