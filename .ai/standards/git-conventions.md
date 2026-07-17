# Git Conventions

## Branches

- `main` — always deployable. No direct commits.
- Feature branches: `feature/<short-description>` (e.g. `feature/user-invites`).
- Fixes: `fix/<short-description>`. Hotfixes: `hotfix/<short-description>`.
- Chores/refactors: `chore/<...>`, `refactor/<...>`.

## Commits — Conventional Commits

Format: `<type>(<scope>): <subject>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Rules:
- Subject in imperative mood, lowercase, no trailing period, ≤ 72 chars.
- Body (optional) explains **why**, wrapped at 72 chars.
- Breaking changes: add `!` after type/scope and a `BREAKING CHANGE:` footer.

Examples:
```
feat(auth): add password reset flow
fix(api): return 404 instead of 500 for missing user
refactor(orders)!: split monolithic service into commands

BREAKING CHANGE: OrderService.create() signature changed.
```

## Pull requests

- Keep PRs small and single-purpose. Reviewer time scales super-linearly with diff size.
- Title follows the Conventional Commits format.
- Description covers: **what**, **why**, **how to test**, and any risks/rollback plan.
- Link the issue/ticket. Include screenshots for UI changes.
- All CI checks green before requesting review.
- Squash-merge by default; the squash message follows Conventional Commits.

## Reviews

- At least one approval before merge; security-sensitive changes need a second.
- Address every comment (resolve or reply). Don't force-push over an in-progress review
  without a heads-up.

## What never goes in git

- Secrets, credentials, `.env` files, tokens. Use the secret manager.
- Large binaries or build artifacts. Use `.gitignore`.
- Generated code unless the build genuinely requires it committed.
