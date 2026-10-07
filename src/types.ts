export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface RecommendedAction {
  title: string;
  commands?: string[];
  note?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  details?: string[];
  actions?: RecommendedAction[];
  data?: Record<string, unknown>;
}

export interface CheckMeta {
  id: string;
  name: string;
  description: string;
}

export type CheckStatus = 'ok' | 'findings' | 'failed';

export interface CheckResult {
  check: string;
  name: string;
  status: CheckStatus;
  durationMs: number;
  findings: Finding[];
  error?: string;
}

export interface HeadInfo {
  branch: string | null;
  sha: string | null;
  detached: boolean;
}

export interface Report {
  tool: 'git-doctor';
  version: string;
  generatedAt: string;
  repoPath: string;
  gitDir: string;
  bare: boolean;
  head: HeadInfo;
  checks: CheckResult[];
  findings: Finding[];
  durationMs: number;
}

export interface DiagnoseOptions {
  checks?: string[];
  skip?: string[];
  history?: number;
  maxFileSizeMB?: number;
  staleDays?: number;
}

export interface ResolvedOptions {
  history: number;
  maxFileSizeMB: number;
  staleDays: number;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface CheckContext {
  repoPath: string;
  gitDir: string;
  bare: boolean;
  head: HeadInfo;
  options: ResolvedOptions;
  git: (args: string[]) => Promise<GitResult>;
}

export interface Check {
  meta: CheckMeta;
  run(ctx: CheckContext): Promise<Finding[]>;
}
