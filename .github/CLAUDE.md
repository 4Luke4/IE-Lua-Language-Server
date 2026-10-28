# CLAUDE.md — GitHub automation (`.github/`)

Scoped notes for workflows, Dependabot and templates. The root `CLAUDE.md` still applies.

## Workflow conventions

- **Pin every action to a full commit SHA** with the version as a comment
  (`uses: actions/checkout@<sha> # v7.0.1`). Resolve SHAs with
  `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`; never type them from memory.
- **Every job has `timeout-minutes`** sized to about 2–3× its normal duration. A run that gets
  near its timeout is a bug to investigate (cache miss, download, hang), not a reason to raise it.
- **Least privilege:** workflow-level `permissions: contents: read`; jobs add only what they need,
  each with a comment saying why.
- **No workflow-level `paths:` filters on required checks** (`ci.yml`, `commitlint.yml`): a skipped
  workflow never reports and blocks merging. Skip inside the workflow instead (`changes` job).
- **Clear failures:** scripts print `::error title=…::<what failed and how to fix it>` (with `file=`
  when known). tsc and ESLint output is annotated by setup-node's problem matchers.
- **Untrusted input** (PR titles, branch names, metadata outputs) goes through `env:`, never
  directly into `run:` with `${{ }}`.
- **Pull requests opened with `GITHUB_TOKEN`** (release, docs sync) do not trigger `pull_request`
  workflows; such jobs must `gh workflow run ci.yml --ref <branch>` and the same for
  `commitlint.yml`. Both workflows therefore keep their `workflow_dispatch` trigger.
- Lint workflows before committing: `actionlint` (https://github.com/rhysd/actionlint).

## Map

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | PR, push to main, dispatch | checks, VSIX artifact, integration tests (min + stable VS Code), WASM reproducibility |
| `commitlint.yml` | PR, dispatch | Conventional Commits for commits and PR title (Dependabot exempt) |
| `codeql.yml` | PR, push, weekly | code scanning (`actions`, `javascript-typescript`) |
| `release.yml` | dispatch → PR; push of `VERSION` | prepare release PR; publish GitHub release (environment `release`) |
| `dependabot-automerge.yml` | Dependabot PR | auto-merge low-risk updates after required checks |
| `eeex-docs-sync*.yml` | weekly, staggered | refresh `data/eeex/*.json` from the published EEex docs |
| `stale.yml` | weekly | stale issues/PRs |

Required status checks on `main` (repository ruleset): the jobs of `ci.yml` and `commitlint.yml`.
