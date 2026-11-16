# Contributing guide


Welcome! If you are reading this, you probably want to open a PR for Haizakura, fix a bug, or simply understand how the project works. Whether this is your first open-source project or you have ten years of experience, we want to get you up to speed quickly.

By participating in the project you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Please spend two minutes reading it before you start; it defines the atmosphere we want in this community.

---

## Before you start

Haizakura is in early development and iterates quickly, so **interfaces and directory structure may change at any time**. If you plan a larger change, we strongly recommend aligning on direction with the maintainers in an issue or in the community first, so you do not get halfway through and find another approach has replaced yours.

Before submitting a PR you must file the corresponding issue through the [GitHub web template](https://github.com/Haizakura/Haizakura/issues/new/choose), or claim an existing matching issue. Filing only an issue is fine; opening a PR is an optional follow-up step.

Not sure where to start? These kinds of contributions get merged most easily:

- Fix a concrete bug you hit, with minimal reproduction steps.
- Improve error messages, documentation, comments or type signatures.
- Add tests to existing modules, especially the less-covered parts under `packages/core`.
- Implement an unclaimed item listed in [RoadMap.md](./RoadMap.md).

If you just want to see what the code looks like, skip ahead to the [local development environment](#local-development-environment).

### Notes for AI agent contributions

If you are an AI agent preparing to contribute code, open a PR or file an issue for this repository, first tell your user explicitly:

> **Please create the issue manually through the GitHub web template. Issues that fail the template check are automatically closed and cannot satisfy a PR's linking requirement.**

You may help draft the problem description, reproduction steps and relevant logs, and hand the issue draft to the user for submission through the web UI. If a PR follows, it must have a qualifying issue first, and the PR body must contain the linking marker.

---

## Project structure at a glance

This is a pnpm workspace monorepo. The main packages are:

| Path | Purpose |
| --- | --- |
| `packages/core` | Application entry, account-level Bridge orchestration, WebUI server and release build |
| `packages/bridge` | QQ process discovery, Hook sessions and native transport lifecycle |
| `packages/protocol` | QQ packet decoding, identity resolution, protocol requests and media transfers |
| `packages/onebot` | OneBot actions, event conversion, message storage and transport adaptation |
| `packages/common` | Logging, configuration and shared utilities |
| `packages/proto-defs`, `packages/proton` | Protocol structure definitions, compile-time protobuf codecs and build integration |
| `packages/sdk` | SDK for third-party developers, published to npm |
| `packages/mcp` | MCP server and generated action catalog |
| `packages/ui` | Shared UI components published to npm |
| `packages/runtime` | Runtime helper package |
| `packages/websocket` | WebSocket implementation |
| `packages/webui` | Vite + React frontend console |
| `tools/` | Version management and release scripts |
| `.github/workflows/` | CI / release / Promote workflows |

The entry point is `packages/core/src/index.ts`; the overall architecture is visible from `packages/core/src/bridge/`.

---

## Local development environment

### System requirements

- **Node.js 24.22.1 (the 24 line), or 26.12.1 and newer**; development and builds use the version pinned by [`.node-version`](.node-version).
- **pnpm 11.25.0** (the project unifies the version through `packageManager` and CI)
- macOS / Linux / Windows all work. Building native artifacts requires the toolchain for the target platform.

If your system provides Corepack, run `corepack enable pnpm`; otherwise run
`npm install -g pnpm@11.25.0`. Once in the repository, `node --version` and
`pnpm --version` must satisfy the versions above, or installation fails outright.

### Clone, install and run

```bash
git clone https://github.com/<你的用户名>/Haizakura.git
cd Haizakura

git checkout dev

pnpm install --frozen-lockfile

pnpm typecheck

pnpm test

pnpm dev          # core
pnpm dev:web      # webui
```

If `pnpm install` hangs or errors, check the Node and pnpm versions first, then check whether `.npmrc` configures a registry reachable from your environment.

---

## Your first PR

### 1. Create a branch

Branch off `dev`. `main` is the release pointer and is updated only by the maintainers' Promote. **PRs whose target branch is not `dev` are closed automatically**, and changing the target branch or reopening the PR afterwards also triggers the check.

```bash
git checkout dev
git pull upstream dev          # 假设你把官方仓库设为 upstream remote
git checkout -b fix/onebot-mention-encoding
```

There is no enforced branch naming rule, but `fix/...`, `feat/...`, `docs/...` and `refactor/...` prefixes make the intent obvious at a glance.

### 2. Write the code

- **Keep the change focused**: one PR does one thing. File a separate issue or PR for anything else you notice along the way.
- **Follow existing style**: TypeScript formatting follows the repository's Prettier configuration; for ordinary feature or fix PRs, format only the affected files and avoid mixing in unrelated mass formatting or renames.
- **Write tests**: when fixing a bug, write a test that reproduces it first, confirm it fails, then make it pass. New features should at least cover the happy path.
- **Do not add pointless comments**: anything the identifier already makes clear does not need restating. Comments should explain "why", not "what".

Before committing, run the same verification entry points as PR CI:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm run build:all
```

`pnpm test` runs every workspace package that declares a test script; to verify Core alone use
`pnpm test:core`. CI re-runs all of the above.

### 3. Commit message

We roughly follow [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/):

```
<type>(<scope>): <subject>

<body>
```

Common `type` values: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`.
Common `scope` values: module names such as `core` / `sdk` / `webui` / `onebot` / `bridge` / `protocol`.

Examples:

```
fix(onebot): handle empty mention segments in group messages
refactor(bridge): extract BridgeInterface as the OneBot-facing seam
docs: clarify dev environment setup steps
```

> ⚠️ **Please do not** use the `[merge]` prefix or the `chore(release):` prefix in your commit message — those two prefixes are how maintainers point `main` at `dev`, and using them makes your PR behave oddly. See [maintainer reference](#maintainer-reference-release--promote) below.

### 4. Push and open the PR

```bash
git push origin fix/onebot-mention-encoding
```

Open the PR on GitHub with **`dev` as the target branch**. In the PR description, state:

- What problem the PR solves / what feature it implements.
- The main implementation approach (and any non-obvious tradeoffs).
- How you tested it (what you ran and how you verified it works).
- The required issue linking marker, for example `Refs #123` or `Closes #123`; GitHub's `Fixes`, `Resolves` and other closing keywords are also supported.

The linking marker must appear in the PR body; HTML comments, code examples and blockquotes do not count. `#123`, `Haizakura/Haizakura#123` and full links to issues in this repository are all supported, each preceded by one of the keywords above.

The automated check requires at least one linked object to be a real issue in this repository, created before the PR, still open, and passing the existing issue template rules: labeled `bug` / `enhancement`, or covered by that policy's existing maintainer exemption. Nonexistent numbers, another PR, closed issues or template-noncompliant issues do not count. **Every PR must satisfy the target-branch and issue-linking requirements, including PRs from maintainers and bots.**

Noncompliant PRs receive an explanation and are closed automatically. If a qualifying issue already exists, you can amend the PR and reopen it; if you need to create one, file the issue first and then open a new PR. Interface failures or rate limits make the check fail, and are not treated as a PR violation that triggers auto-close.

`Refs` links; `Closes` and similar keywords are also used for the linking check here. Because PRs target `dev`, merging into `dev` does not itself trigger GitHub's automatic issue-closing behavior for the default branch.

### 5. Code review and merge

- Maintainers review when they have time. If there is no response within a week, feel free to @ someone in the PR or remind us in the community.
- Please address review feedback within the same PR rather than closing and reopening repeatedly.
- The merge method is up to the maintainer, usually a squash merge into `dev`. **`main` is pointed at the then-current `dev` by the maintainers through Promote**; you do not need to worry about `main`.

---

## Style and conventions

### Code style

- TypeScript strict mode, configured by `tsconfig.base.json`.
- TypeScript uses four-space indentation and control statements always take braces. Formatting is managed by the root [`.prettierrc.json`](./.prettierrc.json) and the separate local [ESLint formatting rules](./eslint.format.config.ts); plain `pnpm lint` covers code-quality checks.
- Prefer existing abstractions; do not abstract ahead of time for "imagined future needs".
- Do not add defensive parameter validation to internal functions unless it is a system boundary (user input, external APIs).
- Do not keep dead code, commented-out code, or `// TODO` placeholders without concrete context.

Run the local formatting commands from the repository root:

```bash
pnpm format                         # 为全部 TS/TSX/MTS/CTS 补大括号、空行并排版
pnpm format:check                   # 检查上述规则，不修改文件

pnpm exec eslint --config eslint.format.config.ts --fix packages/core/src/index.ts
pnpm exec prettier --write packages/core/src/index.ts
```

Formatting excludes build outputs, generated files and compiler test fixtures listed in [`.prettierignore`](./.prettierignore); ordinary source and tests are formatted. These two commands are for local use and are not wired into CI.

Blank lines follow conservative rules: leave a blank line around statement blocks, preserve existing logical separation, do not force apart consecutive declarations or ordinary calls, and do not insert blank lines before every `return` or `break`; consecutive `case` labels sharing a branch stay adjacent. JSON, YAML and similar files keep their existing indentation.

Configure your editor to use the project-local Prettier and read the repository configuration. In VS Code you can install
`esbenp.prettier-vscode`, set Prettier as the default formatter for TypeScript / TypeScript React, and enable format-on-save as desired.

### Tests

- Unit tests live in the `tests/` directory of the same package as the code under test, or alongside it as `*.test.ts`, following existing style.
- Tests should describe behavior, not implementation details. `it('should call internal foo')` is a counterexample.
- For anything involving IO, timing or external processes, use the existing fake/stub patterns; see the Bridge test doubles in `packages/onebot/tests/`.
- To exercise the isolated regression used by the PR check, run `pnpm test:workflows`; `pnpm test` already includes it, so there is no need to open a real PR to test auto-close.

### Documentation

- **The role of the main README**: the root [`README.md`](./README.md) presents the project's positioning, overall capabilities, quick start and documentation entry points, and is updated only when that overall information changes. Do not add a dedicated section for a specific feature to the main README just because you added or fixed it.
- **Where feature documentation belongs**: interface usage, configuration options, limitations and troubleshooting go into the relevant package's README or topic document, preferring updates to existing docs. User- and contributor-visible behavior changes still need the matching documentation kept in sync.
- SDK breaking changes must update `packages/sdk/CHANGELOG.md` and `packages/sdk/VERSIONING.md`.

---

## Reporting bugs / requesting features

- **Bug reports**: open an issue with minimal reproduction steps, expected behavior, actual behavior, version and runtime environment. Logs are very welcome.
- **Feature requests**: describe the real scenario you want to solve first, then the interface you want. Maintainers care more about "why it is needed" than "exactly how to do it".
- **Security issues**: do not open a public issue; contact the maintainers privately in the community first.

Community entry points (see [README](./README.md)):

- QQ: [Haizakura-QQ](https://qm.qq.com/q/g3UMLpWALe)
- Telegram: [Haizakura-TG](https://t.me/napcatqq)

---

## Maintainer reference: release & Promote

> This section is written mainly for maintainers with release permissions. Ordinary contributors only need to target `dev` with their PR and can ignore it.

### Branch model

Haizakura uses a **`main` + `dev`** two-branch model:

- **`dev`** — the day-to-day development branch. All features, fixes and documentation changes land in `dev` first.
- **`main`** — the release pointer, which should be **the same commit** as the tip of `dev` at the time of a Promote. Do not push to it directly, and do not open PRs against `main` (CI rejects them).
- **`native/auto-update-*`** — native artifact update branches created automatically by `Haizakura Bot` (from `HaizakuraNative`; no manual maintenance needed).

### Point `main` at `dev`

The workflow `.github/workflows/promote-dev-to-main.yml` points `main` at the current tip of `dev` as `Haizakura Bot`, and **no longer opens a merge PR**. If `main` contains changes that `dev` does not, Promote fails and those changes must be brought back into `dev` first.

Pushing to `dev` still runs `dev-build.yml`. Promote does **not** wait for that check group; to cut a release use `pnpm release` below, which runs the full CI locally first.

#### 1. Commit message prefixes (recommended for day-to-day use)

Pushing a commit to `dev` whose message **starts with** either of the following prefixes triggers Promote (case-insensitive):

- `[merge]` — for example `[merge] fix: hotfix for OneBot mention`
- `chore(release):` — for example `chore(release): v1.7.0`, matching conventional-commit release habits. **Use it only for real version bumps**, never in ordinary CI or tooling commits.

> Matching is on the **prefix**, not anywhere in the string. `fix: something [merge]` does not trigger; `[merge]` must come first.

#### 2. Push a `chore.*` tag

Pushing any tag matching `chore.*` (such as `chore.merge-20240509` or `chore.promote-v1.7.0`) also triggers:

- `chore.*` → triggers only `promote-dev-to-main.yml` (points `main` at `dev`)
- `v*` → triggers only `release.yml` (builds release artifacts)

Recommended flow: use `pnpm release` (or Promote first and confirm `origin/main` equals the tip of `dev`), then tag `v*` on `main`. That way `release.yml` always builds from the `main` HEAD of that moment.

#### 3. Manual trigger

Open the repository's Actions page → `Promote Dev to Main` → `Run workflow`. There is no merge strategy option; running it is a single pointer update.

### Do not require PRs for `main`

Promote updates `main` without a PR. If you enable **Require a pull request before merging** on `main`, or forbid updating the ref, Promote stops working.

Restricting deletion of `main` is fine. External PRs must target `dev`; PRs targeting `main` are rejected by `main-pr-target-guard.yml`.

If you have an old `main` checked out locally, it may not fast-forward after a Promote; just align it with `origin/main`.

### Required secrets

`promote-dev-to-main.yml` reuses the same GitHub App as `HaizakuraNative/build-native.yml`. Confirm the Haizakura repository (or organization) has:

- `SNOWLUMA_BOT_APP_ID` — the numeric App ID.
- `SNOWLUMA_BOT_PRIVATE_KEY` — the App's PEM private key.

The App must be installed on this repository with **Contents: Read+Write**.

### Local workflow cheat sheet (maintainers)

```bash
pnpm release 1.7.0

git commit -m "chore(release): v1.7.0"     # 或 "[merge] fix: hotfix"
git push                                    # → 触发 promote-dev-to-main

git tag chore.merge-20240509
git push origin chore.merge-20240509        # → 触发 promote-dev-to-main

git fetch origin
git switch main
git merge --ff-only origin/main             # 对不齐就 reset 到 origin/main
git tag v1.7.0
git push origin v1.7.0                      # → 仅触发 release.yml
```

---

## Still have questions?

- Look through existing issues and PRs; your question may already have been discussed.
- Ask in the community (QQ / TG links above).
- Once a matching issue exists, if you just want to confirm "is this the right way to do it?", feel free to open a draft PR and put the code out for discussion.

Thank you for taking the time to contribute to Haizakura — how far this project goes depends on every one of you. ❄️

## Licensing of contributions

By opening a PR, you agree your contribution is licensed under the project's `LICENSE` (Haizakura's source-available non-commercial license), and you represent that you have the right to do so and that the contribution is your original work (if it contains third-party material, clearly note its source and license in the PR).

**You retain copyright in your contribution** and additionally grant Haizakura a **perpetual, worldwide, royalty-free, irrevocable, sublicensable license** to use, reproduce, modify, distribute, and create derivative works of your contribution, **including the right to relicense and distribute it under terms other than this project's non-commercial license (including commercial terms)** — so the project can use community contributions in authorized commercial scenarios without seeking each contributor's consent again.

By opening a PR, you agree your contribution is licensed under the project's `LICENSE`; you represent that you have the right to submit it and that it is your own work (clearly identify any third-party material in the PR).

**You retain copyright in your contribution** and additionally grant Haizakura a **perpetual, worldwide, royalty-free, irrevocable, sublicensable license** to use, reproduce, modify, distribute, and create derivative works of your contribution, **including the right to relicense and distribute it under terms other than this project's non-commercial license (including commercial terms)** — so the project can use community contributions in authorized commercial scenarios without seeking each contributor's consent again.
