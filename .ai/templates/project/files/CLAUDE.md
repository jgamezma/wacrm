<!-- template-managed: project/CLAUDE.md — edits here are yours; sync will diff, not clobber -->

# Project AI Guide

This file is read automatically by Claude Code. It wires in the shared IdeasLab standards,
roles, and workflows (synced under `.ai/`) plus this project's own context.

> Keep this file thin. Put shared rules in `.ai/` (managed by the template library) and
> project-specific facts in `.ai/project-context.md` and `.ai/architecture.md`.

## Project context (project-owned)

@.ai/project-context.md
@.ai/architecture.md

## Standards (shared — synced from ai-dev-template-library)

@.ai/standards/coding-standards.md
@.ai/standards/git-conventions.md
@.ai/standards/api-guidelines.md
@.ai/standards/database-guidelines.md
@.ai/standards/testing-guidelines.md
@.ai/standards/security-guidelines.md

## How to work here

- Adopt the relevant **role** for the task — see `.ai/roles/`.
- Follow the matching **workflow** — see `.ai/workflows/`.
- When context changes (new service, new decision), update `.ai/project-context.md` and
  `.ai/architecture.md`.

## Golden rules

1. Match the surrounding code. Read before you write.
2. Tests ship with the change, not after.
3. Never commit secrets. Validate input at boundaries.
4. Small, single-purpose commits and PRs (Conventional Commits).
5. Prefer the simplest thing that works — no speculative complexity.
