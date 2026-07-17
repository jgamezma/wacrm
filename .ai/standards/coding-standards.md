# Coding Standards

> Shared across all projects. Language-specific rules live in the relevant stack template.

## Principles

- **Clarity over cleverness.** Optimize for the next person reading the code.
- **Small, focused units.** Functions do one thing; files have one responsibility.
- **Fail loudly.** Validate inputs at boundaries; never swallow errors silently.
- **Match the surrounding code.** New code should read like the code already there —
  naming, structure, comment density.

## Naming

- Use descriptive, intention-revealing names. Avoid abbreviations except well-known ones.
- Booleans read as assertions: `is_active`, `has_access`, `should_retry`.
- Constants are `UPPER_SNAKE_CASE`. No magic numbers or strings in logic.

## Structure

- Keep functions under ~40 lines; extract when they grow past that.
- Prefer pure functions; isolate side effects (I/O, network, DB) at the edges.
- One export concern per module. Avoid "utils" dumping grounds.

## Comments

- Comment the **why**, not the **what**. The code says what.
- Keep a public docstring/JSDoc on every exported function, class, and module.
- Remove dead code — don't comment it out. Git remembers.

## Error handling

- Never catch-and-ignore. Log with context, then re-raise or return a typed error.
- Use domain-specific error types over generic exceptions.
- Validate at system boundaries (API input, external responses, env config).

## Formatting & linting

- Formatting is not a matter of opinion — the formatter decides. No manual style debates.
- CI fails on lint/format violations. Fix them; do not disable rules inline without a
  comment explaining why.

## Language specifics

See the stack template for concrete tooling:

- **Python (FastAPI):** `ruff` (lint + format), `mypy` (types), type hints on all signatures.
- **TypeScript (Next.js):** `eslint` + `prettier`, `strict` tsconfig, no `any` without justification.

## Definition of done for any change

- [ ] Reads like the surrounding code.
- [ ] Has tests for new behavior (see [testing-guidelines](./testing-guidelines.md)).
- [ ] Passes lint, format, type-check, and tests locally.
- [ ] No secrets, no debug prints, no commented-out code.
- [ ] Follows [git-conventions](./git-conventions.md) for the commit/PR.
