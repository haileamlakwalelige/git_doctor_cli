export { diagnose, GitDoctorError, DEFAULT_OPTIONS } from './diagnose.js';
export { renderText, renderJson } from './report.js';
export { ALL_CHECKS, CHECK_IDS } from './checks/index.js';
export { VERSION } from './version.js';
export type {
  Check,
  CheckContext,
  CheckResult,
  DiagnoseOptions,
  Finding,
  RecommendedAction,
  Report,
  Severity,
} from './types.js';
