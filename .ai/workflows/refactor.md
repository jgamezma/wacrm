# Workflow: Refactor

Refactoring changes structure, **not behavior**. If behavior changes, it's a feature or a fix —
use that workflow instead.

## 1. Justify
- State the concrete pain: duplication, coupling, unclear naming, hot spot for bugs.
- Refactor with a purpose (enabling an upcoming change, reducing defect rate), not for taste.

## 2. Secure a safety net
- Ensure the affected code has tests that capture current behavior.
- If coverage is thin, **add characterization tests first** — they must pass before you start.

## 3. Refactor in small steps
- Branch: `refactor/<short-description>`.
- Make one structural change at a time; run tests after each step.
- Keep each commit green and revertible. No behavior change per commit.
- Common moves: extract function/module, rename, inline, introduce interface, remove dead code.

## 4. Verify no behavior changed
- Full test suite green throughout.
- Diff review focuses on: "is this truly behavior-preserving?"
- Check performance didn't regress on hot paths.

## 5. Review & ship
- PR clearly states "refactor, no behavior change" and how that's verified.
- Follow [code-review](./code-review.md). Reviewers confirm behavior preservation.
- Keep refactor PRs separate from feature PRs — never mix.

## Guardrails
- Don't refactor and change behavior in the same commit/PR.
- Don't start without a test safety net.
- Timebox large refactors; land incrementally rather than a giant big-bang PR.

## Definition of done
- [ ] Behavior provably unchanged (tests + review).
- [ ] Stated pain point actually reduced.
- [ ] No mixed feature/fix changes.
- [ ] Suite green; performance not regressed.
