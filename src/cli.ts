#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { diagnose, GitDoctorError } from './diagnose.js';
import { exitCodeFor, renderJson, renderText } from './report.js';
import { ALL_CHECKS } from './checks/index.js';
import { SEVERITIES, type DiagnoseOptions, type Severity } from './types.js';
import { VERSION } from './version.js';

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Expected a non-negative integer, got "' + value + '".');
  }
  return parsed;
}

function parseFloatOption(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive number, got "' + value + '".');
  }
  return parsed;
}

function splitIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

interface CliOptions {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  checks?: string;
  skip?: string;
  history: number;
  maxFileSize: number;
  staleDays: number;
  failOn: string;
  listChecks?: boolean;
  ignoreFile?: string;
  ignore?: boolean;
  color: boolean;
}

let paintError = (text: string): string => text;

function listChecks(): void {
  const width = Math.max(...ALL_CHECKS.map((check) => check.meta.id.length));
  process.stdout.write('Available checks:\n\n');
  for (const check of ALL_CHECKS) {
    process.stdout.write('  ' + check.meta.id.padEnd(width + 2) + check.meta.description + '\n');
  }
}

async function main(): Promise<number> {
  const program = new Command();

  program
    .name('git-doctor-cli')
    .description('Diagnose broken and confusing Git repositories. Like ESLint for your Git repo.')
    .version(VERSION)
    .argument('[path]', 'path to the repository to inspect', '.')
    .option('--json', 'print a machine-readable JSON report')
    .option('-v, --verbose', 'also show checks that passed')
    .option('-q, --quiet', 'print nothing; report through the exit code only')
    .option('--checks <ids>', 'only run these checks (comma-separated ids)')
    .option('--skip <ids>', 'skip these checks (comma-separated ids)')
    .option('--history <n>', 'commits to scan for secrets, 0 = full history', parseIntOption, 200)
    .option('--max-file-size <mb>', 'flag files larger than this many MB', parseFloatOption, 50)
    .option('--stale-days <n>', 'days before a merged branch counts as stale', parseIntOption, 90)
    .option('--fail-on <level>', 'severity that makes the command exit 1', 'high')
    .option('--list-checks', 'list the available checks and exit')
    .option('--ignore-file <path>', 'file with ignore rules (default: <repo>/.gitdoctorignore)')
    .option('--no-ignore', 'do not read .gitdoctorignore')
    .option('--no-color', 'disable colored output')
    .addHelpText(
      'after',
      `
Exit codes:
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  fatal error, or at least one check failed

Ignore file:
  .gitdoctorignore hides findings you have already accepted, so this
  repository can be checked in CI without failing on known fixtures.

    test/**            ignore matching paths from any check
    secrets            ignore every finding of a check
    secrets:test/**    ignore matching paths from one check
    # comment
`,
    );

  program.parse(process.argv);
  const options = program.opts<CliOptions>();
  const path = program.args[0] ?? '.';

  if (options.listChecks) {
    listChecks();
    return 0;
  }

  if (options.failOn !== 'never' && !SEVERITIES.includes(options.failOn as Severity)) {
    throw new GitDoctorError(
      'Invalid --fail-on value "' + options.failOn + '". Use one of: ' +
        SEVERITIES.join(', ') + ', never.',
    );
  }

  const diagnoseOptions: DiagnoseOptions = {
    history: options.history,
    maxFileSizeMB: options.maxFileSize,
    staleDays: options.staleDays,
  };
  if (options.checks) diagnoseOptions.checks = splitIds(options.checks);
  if (options.skip) diagnoseOptions.skip = splitIds(options.skip);
  if (options.ignore === false) diagnoseOptions.ignoreFile = null;
  else if (options.ignoreFile) diagnoseOptions.ignoreFile = resolve(options.ignoreFile);

  const report = await diagnose(path, diagnoseOptions);

  if (!options.quiet) {
    const useColor = options.color && !process.env.NO_COLOR;
    paintError = useColor ? (text: string) => pc.red(text) : (text: string) => text;
    const output = options.json
      ? renderJson(report)
      : renderText(report, { color: useColor, verbose: Boolean(options.verbose) });
    process.stdout.write(output + '\n');
  }

  return exitCodeFor(report, options.failOn);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof GitDoctorError) {
      process.stderr.write(paintError('git-doctor-cli: ') + error.message + '\n');
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(paintError('git-doctor-cli: ') + message + '\n');
    process.exitCode = 2;
  });
