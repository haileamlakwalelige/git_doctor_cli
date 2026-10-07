import { describe, expect, it } from 'vitest';
import { detectUrlCredential } from '../src/checks/config.js';
import { parseSubmoduleStatus } from '../src/checks/submodules.js';

describe('detectUrlCredential', () => {
  it('flags a token embedded in an https URL', () => {
    const result = detectUrlCredential('https://ghp_abc123def456@github.com/user/repo.git');
    expect(result).not.toBeNull();
    expect(result?.severity).toBe('high');
    expect(result?.redactedUrl).toBe('https://***@github.com/user/repo.git');
    expect(result?.redactedUrl).not.toContain('ghp_abc123def456');
  });

  it('flags a password in an https URL as critical', () => {
    const result = detectUrlCredential('https://user:hunter2@git.example.com/repo.git');
    expect(result?.severity).toBe('critical');
    expect(result?.redactedUrl).not.toContain('hunter2');
  });

  it('flags credentials in non-http protocols as high', () => {
    const result = detectUrlCredential('ftp://user:pass@ftp.example.com/repo.git');
    expect(result?.severity).toBe('high');
  });

  it('ignores normal ssh URLs', () => {
    expect(detectUrlCredential('git@github.com:user/repo.git')).toBeNull();
    expect(detectUrlCredential('ssh://git@github.com/user/repo.git')).toBeNull();
  });

  it('flags scp-style URLs that look like tokens', () => {
    expect(detectUrlCredential('ghp_abc123def456ghi789jkl012@github.com:user/repo.git')).not.toBeNull();
    expect(detectUrlCredential('myuser@github.com:user/repo.git')).toBeNull();
  });
});

describe('parseSubmoduleStatus', () => {
  it('parses initialized, missing and modified submodules', () => {
    const stdout = [
      ' 4b825dc642cb6eb9a060e54bf8d69288fbee4904 packages/ui (v1.0.0)',
      '-8c7e5b44d3a2f1e0c9b8a7g6f5e4d3c2b1a09876 packages/api (heads/main)',
      '+1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d packages/core (v2.1.0-3-g1a2b3c4)',
      'U6f5e4d3c2b1a098718c7e5b44d3a2f1e0c9b8a7g packages/conflict',
    ].join('\n');

    const entries = parseSubmoduleStatus(stdout);
    expect(entries).toHaveLength(4);
    expect(entries[0]?.flag).toBe(' ');
    expect(entries[0]?.path).toBe('packages/ui');
    expect(entries[1]?.flag).toBe('-');
    expect(entries[1]?.path).toBe('packages/api');
    expect(entries[2]?.flag).toBe('+');
    expect(entries[3]?.flag).toBe('U');
    expect(entries[3]?.path).toBe('packages/conflict');
  });

  it('ignores blank lines', () => {
    expect(parseSubmoduleStatus('')).toHaveLength(0);
    expect(parseSubmoduleStatus('\n\n')).toHaveLength(0);
  });
});
