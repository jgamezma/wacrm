# Workflow: Code Review

Reviews protect the codebase and share knowledge. Be rigorous on substance, kind in tone.

## For the author (before requesting review)
- Self-review the diff first. Remove debug code, TODOs, and noise.
- Keep it small and single-purpose. Split large PRs.
- PR description: what, why, how to test, risks/rollback. Link the issue.
- All CI green: tests, lint, type-check, security scan.

## For the reviewer

Review in this order of priority:

1. **Correctness** — Does it do what it claims? Edge cases, error paths, concurrency.
2. **Security** — Input validation, authz, injection, secrets, data leaks
   (see [security-guidelines](../standards/security-guidelines.md)).
3. **Design** — Right abstraction and boundaries? Consistent with the architecture?
4. **Tests** — Meaningful coverage of new behavior, including failure cases.
5. **Readability** — Clear names, matches surrounding style, comments explain *why*.
6. **Performance** — Obvious N+1s, unbounded queries, needless work.

## Comment conventions
- Prefix by intent: `blocking:` (must fix), `nit:` (optional), `question:`, `praise:`.
- Explain the *why* and suggest a concrete alternative.
- Distinguish "wrong" from "I'd do it differently." Don't block on taste.

## For both
- Resolve or reply to every comment.
- Re-request review after substantive changes.
- Approve only when you'd be comfortable owning the code.

## Merge criteria
- [ ] At least one approval (two for security-sensitive changes).
- [ ] All comments resolved; CI green.
- [ ] Squash-merge with a Conventional Commit message.
