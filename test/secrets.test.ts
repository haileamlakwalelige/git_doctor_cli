import { describe, expect, it } from 'vitest';
import { isCandidate, matchSecrets, redact } from '../src/checks/secrets.js';

const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
const SLACK_TOKEN = 'xoxb-' + '1234567890-abcdefghijklmn';

describe('secret pattern matching', () => {
  it('detects GitHub tokens', () => {
    const matches = matchSecrets('const auth = "' + GITHUB_TOKEN + '";');
    expect(matches.map((match) => match.pattern.id)).toContain('github-token');
    expect(matches[0]?.value).toBe(GITHUB_TOKEN);
  });

  it('detects AWS access key IDs', () => {
    const matches = matchSecrets('AWS_KEY=AKIAIOSFODNN7EXAMPLE');
    expect(matches.map((match) => match.pattern.id)).toContain('aws-access-key');
  });

  it('detects private key blocks', () => {
    const matches = matchSecrets('-----BEGIN RSA PRIVATE KEY-----');
    expect(matches.map((match) => match.pattern.id)).toContain('private-key');
  });

  it('detects Slack and OpenAI tokens', () => {
    expect(matchSecrets(SLACK_TOKEN)[0]?.pattern.id).toBe('slack-token');
    expect(matchSecrets('key: sk-proj-abcdef1234567890ABCD')[0]?.pattern.id).toBe('openai-key');
  });

  it('flags generic credentials but not placeholders', () => {
    expect(matchSecrets('password = "hunter2hunter2"')).toHaveLength(1);
    expect(matchSecrets('password = "changeme1234"')).toHaveLength(0);
    expect(matchSecrets('password = "xxxxxxxxxxxx"')).toHaveLength(0);
    expect(matchSecrets('password = "<your-password-here>"')).toHaveLength(0);
    expect(matchSecrets('password = "example"')).toHaveLength(0);
  });

  it('ignores ordinary code', () => {
    expect(matchSecrets('const tokenCount = 12;')).toHaveLength(0);
    expect(matchSecrets('import { secretSanta } from "./holiday";')).toHaveLength(0);
    expect(matchSecrets('git commit -m "password reset flow"')).toHaveLength(0);
  });

  it('ignores type annotations, calls and bare identifiers (found on self-run)', () => {
    expect(matchSecrets('const credential: UrlCredential | null = null;')).toHaveLength(0);
    expect(matchSecrets('const credential = detectUrlCredential(url);')).toHaveLength(0);
    expect(matchSecrets('secrets: secretData(critical),')).toHaveLength(0);
  });

  it('still flags unquoted credentials that look like secrets', () => {
    expect(matchSecrets('AWS_SECRET=a1B2c3D4e5F6g7H8')).toHaveLength(1);
    expect(matchSecrets('password = "hunter2hunter2"')).toHaveLength(1);
    expect(matchSecrets('const password = hunter2hunter2;')).toHaveLength(1);
  });

  it('matches keyword after an underscore but not inside a word', () => {
    expect(matchSecrets('DB_SECRET=x9K2mP4qR7sT')).toHaveLength(1);
    expect(matchSecrets('const secretSanta = 1;')).toHaveLength(0);
    expect(matchSecrets('const notasecret = 1;')).toHaveLength(0);
  });

  it('pre-filters lines that cannot contain secrets', () => {
    expect(isCandidate('plain prose with no markers in it at all')).toBe(false);
    expect(isCandidate('const apiKey = "value1234567890"')).toBe(true);
    expect(isCandidate('short')).toBe(false);
  });

  it('redacts values so they never appear in output', () => {
    const redacted = redact(GITHUB_TOKEN);
    expect(redacted).not.toContain(GITHUB_TOKEN);
    expect(redacted.startsWith('ghp_a1')).toBe(true);
    expect(redact('abc')).not.toBe('abc');
  });

  it('finds several secrets on one line', () => {
    const line = 'aws=AKIAIOSFODNN7EXAMPLE slack=' + SLACK_TOKEN;
    const matches = matchSecrets(line);
    expect(matches).toHaveLength(2);
  });
});
