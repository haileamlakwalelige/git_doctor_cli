<h1 align="center">git-doctor-cli</h1>

<p align="center">
  <strong>Diagnose broken and confusing Git repositories.</strong><br>
  Like ESLint for your Git repo.
</p>

<p align="center">
  Read-only · Runs locally · No telemetry · MIT
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/git-doctor-cli">npm</a> ·
  <a href="https://haileamlakwalelige.github.io/git_doctor_cli/">website</a> ·
  <a href="https://github.com/haileamlakwalelige/git_doctor_cli">GitHub</a>
</p>

---

`git-doctor-cli` inspects a Git repository and reports what is wrong — secrets committed in history, lost commits, stale branches, oversized files, unfinished operations — and hands you the exact commands that fix each one.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Usage](#usage)
- [The 10 checks](#the-10-checks)
- [Ignoring findings you accept](#ignoring-findings-you-accept)
- [Use it as a library](#use-it-as-a-library)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

## Install

```bash
npm install -g git-doctor-cli
```

Installs the `git-doctor-cli` command — `git-doctor` works as a short alias.
Requires **Node.js 20+** and **git** on your PATH.

## Quick start

```bash
git-doctor-cli                 # the repository you are in
git-doctor-cli path/to/repo    # any other repository
git-doctor-cli --list-checks   # print the ten checks and exit
```

```text
Git Doctor v0.1.2
~/projects/my-app (branch main, c9ec4ab2)

  ✖ 1 secret detected in previous commits
       - GitHub token: ghp_ab****** (38 chars) (first in 2c544284, src/config.js)
       Scanned the last 4 commits.
  ▲ 1 dangling commit found
       Sample: fb0bbf74
       These commits are unreachable from every branch; reflogs normally keep them alive for about 90 days.
  ▲ 1 tracked file is also matched by .gitignore
  ⚠ 1 branch contains unmerged work
  • Branch 'main' has no upstream

Recommended actions

  1. Rotate the exposed credential
       Revoke and regenerate them in the provider dashboard first — treat them as compromised.
  2. Inspect the 1 dangling commit
       git fsck --lost-found
       git show <sha>
  3. Stop tracking the sensitive files
       git rm --cached .env

8 findings (1 critical, 2 high, 2 medium, 1 low, 2 info) from 10 checks in 1.62s
```

> **Safe by default.** Everything runs locally — no server, no telemetry, and your
> repository never leaves your machine. Secret values are redacted in all output,
> text and JSON, so reports are safe to share.

## Usage

```bash
git-doctor-cli --json                     # machine-readable report (for CI)
git-doctor-cli -v                         # also show the checks that passed
git-doctor-cli --fail-on medium           # stricter gate
git-doctor-cli --checks secrets,large-files --history 0
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--checks <ids>` | all | run only the listed checks |
| `--skip <ids>` | none | skip the listed checks |
| `--history <n>` | `200` | commits to scan for secrets (`0` = full history) |
| `--max-file-size <mb>` | `50` | flag files larger than this anywhere in history |
| `--stale-days <n>` | `90` | age before a merged branch counts as stale |
| `--fail-on <level>` | `high` | severity that makes the command exit `1` |
| `--ignore-file <path>` | `<repo>/.gitdoctorignore` | file with ignore rules |
| `--no-ignore` | | do not read `.gitdoctorignore` |
| `--json` | | print a JSON report |
| `-v, --verbose` | | include passing checks |
| `-q, --quiet` | | no output, exit code only |
| `--no-color` | | disable colors |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | no findings at or above `--fail-on` |
| `1` | findings at or above `--fail-on` |
| `2` | fatal error, or at least one check failed |

Which makes it a drop-in CI gate:

```yaml
- run: npx git-doctor-cli --fail-on high
```

## The 10 checks

| Check | What it finds |
| --- | --- |
| `repo` | detached HEAD, unfinished merge/rebase/cherry-pick/bisect, unresolved conflicts, uncommitted changes |
| `dangling` | commits unreachable from every branch (lost after a reset, rebase or deleted branch) |
| `branches` | branches with unmerged work, stale merged branches, branches tracking deleted remotes, missing upstream |
| `sync` | branches ahead of / behind their upstream, unpushed commits |
| `large-files` | oversized blobs anywhere in history |
| `secrets` | GitHub/AWS/Slack/OpenAI/Google/Stripe/npm tokens, private keys, generic embedded credentials |
| `ignored-tracked` | files that are committed *and* matched by `.gitignore` (`.env`, keys, …) |
| `config` | missing `user.name`/`user.email`, credentials embedded in remote URLs, missing remotes |
| `submodules` | uninitialized, out-of-date or conflicted submodules, gitlinks without `.gitmodules` |
| `stash` | stashes you may have forgotten |

Every finding comes with concrete commands to run, and `git-doctor-cli` never
modifies your repository — it is strictly read-only.

## Ignoring findings you accept

Some findings are deliberate — test fixtures with fake tokens, an internal repo
with no remote, a project that is fine being dirty. Record them in
`.gitdoctorignore` at the repository root and they stop affecting the exit code
(they are still counted and reported as hidden):

```
# comments and blank lines are fine
test/**              # any check: matching paths
secrets              # every finding of one check
secrets:test/**      # one check: matching paths
```

Patterns are globs: `*` stays inside one path segment, `**` crosses
directories, `?` matches one character. Paths are matched against every path,
branch and value a finding carries (`.env`, `assets/big.psd`, `main`, …).

Use `--no-ignore` to see everything, or `--ignore-file <path>` to point at
another file. The library equivalent is `diagnose(path, { ignore: [...] })`.

## Use it as a library

```ts
import { diagnose, renderText } from 'git-doctor-cli';

const report = await diagnose('/path/to/repo', { maxFileSizeMB: 100 });
console.log(renderText(report, { color: true, verbose: false }));
```

## Development

<details>
<summary>Build, lint and test</summary>

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Tests build real repositories in a temp directory (detached HEADs, unfinished
merges, dangling commits, secrets, oversized files) and assert what the tool
reports.

</details>

## Roadmap

- `git-doctor-cli fix --safe` — apply only reversible fixes, behind a backup ref
- pre-commit hooks, CI reporters and per-team `--fail-on` profiles
- Homebrew, Scoop and Winget packages
- VS Code extension

## License

MIT
