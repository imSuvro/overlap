# Contributing to Overlap

## Branching model

| Branch                                    | Purpose                                                                           | Protection                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `main`                                    | Always deployable. Every commit is a release candidate; releases are tagged here. | Protected. PR only, linear history, all CI checks required, force-push and deletion blocked. |
| `develop`                                 | Integration branch. Features land here first.                                     | Protected. PR only, all CI checks required.                                                  |
| `feature/*`, `fix/*`, `chore/*`, `docs/*` | Short-lived. Branched from `develop`, squash-merged back.                         | None — they are expected to be rewritten freely.                                             |

```
feature/grid-rendering ──┐
feature/offline-sync ────┼──► develop ──► main ──► tag v1.2.0 ──► deploy
fix/dst-ambiguity ───────┘
```

### Working on something

```bash
git switch develop && git pull
git switch -c feature/short-description
# ... commit as you go ...
git push -u origin feature/short-description
gh pr create --base develop
```

Squash-merge into `develop`. The squashed subject must itself be a valid Conventional Commit,
because that is what ends up in `main`'s history and drives the changelog.

### Releasing

```bash
gh pr create --base main --head develop --title "release: v1.2.0"
# after CI passes and the PR merges:
git switch main && git pull
git tag -a v1.2.0 -m "v1.2.0 — <headline>"
git push origin v1.2.0
```

Deployment to production runs from `main` only, and only after CI has passed there.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint both as a
local `commit-msg` hook and as a CI job over the whole PR range — so a bypassed local hook still
fails the merge.

```
feat(crdt): add hybrid logical clock with skew clamping
fix(time): resolve fall-back hour to two distinct instants
docs(repo): record the rendering decision in ADR-0005
```

Allowed scopes: `time`, `crdt`, `protocol`, `room-core`, `web`, `edge`, `dev-server`, `e2e`,
`ci`, `docs`, `repo`.

## Local setup

```bash
pnpm install     # also points core.hooksPath at .githooks
pnpm dev         # Vite client + Node WebSocket server
pnpm verify      # lint, typecheck, test, build — what CI runs
```

## The bar for a change

- **No `any`.** ESLint's `no-unsafe-*` family is on and set to error.
- **Validate at every boundary.** Anything crossing the wire, coming out of IndexedDB, or read
  from a URL goes through a Zod schema. Types are inferred _from_ schemas so the static and
  runtime views cannot drift.
- **Keyboard parity.** Any interaction that can be done with a pointer must be doable with a
  keyboard, with a visible focus state and a screen-reader label.
- **Architectural decisions get an ADR.** If a PR changes how the system works rather than what
  it does, it adds or supersedes a document in `docs/adr/`.
