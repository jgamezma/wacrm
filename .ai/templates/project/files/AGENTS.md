# AGENTS.md

Cross-tool agent instructions (the open standard read by Cursor and other agents).
This mirrors `CLAUDE.md`; both point at the same shared content under `.ai/`.

## Where the rules live

- **Project context:** `.ai/project-context.md`, `.ai/architecture.md`
- **Standards:** `.ai/standards/` (coding, git, api, database, testing, security)
- **Roles:** `.ai/roles/` — adopt the one matching the task
- **Workflows:** `.ai/workflows/` — follow the matching process

Read the relevant files under `.ai/` before starting a task.

## Golden rules

1. Match the surrounding code style; read before writing.
2. Tests ship with the change.
3. Never commit secrets; validate input at boundaries.
4. Small, single-purpose commits and PRs using Conventional Commits.
5. Simplest solution that satisfies the requirement — no speculative complexity.

## Standards & workflows quick links

- Coding: `.ai/standards/coding-standards.md`
- Git: `.ai/standards/git-conventions.md`
- Security: `.ai/standards/security-guidelines.md`
- Testing: `.ai/standards/testing-guidelines.md`
- Feature workflow: `.ai/workflows/feature-development.md`
- Bug-fix workflow: `.ai/workflows/bug-fix.md`
