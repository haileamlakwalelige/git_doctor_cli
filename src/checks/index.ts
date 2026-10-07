import type { Check } from '../types.js';
import { repoCheck } from './repo.js';
import { danglingCheck } from './dangling.js';
import { branchesCheck } from './branches.js';
import { syncCheck } from './sync.js';
import { largeFilesCheck } from './large-files.js';
import { secretsCheck } from './secrets.js';
import { ignoredTrackedCheck } from './ignored-tracked.js';
import { configCheck } from './config.js';
import { submodulesCheck } from './submodules.js';
import { stashCheck } from './stash.js';

export const ALL_CHECKS: Check[] = [
  repoCheck,
  danglingCheck,
  branchesCheck,
  syncCheck,
  largeFilesCheck,
  secretsCheck,
  ignoredTrackedCheck,
  configCheck,
  submodulesCheck,
  stashCheck,
];

export const CHECK_IDS: string[] = ALL_CHECKS.map((check) => check.meta.id);
