# Workflow: Bug Fix

Fix the cause, not the symptom — and prove it with a test.

## 1. Reproduce
- Get exact steps, environment, and expected vs. actual behavior.
- Reproduce locally. If you can't reproduce it, you can't confirm the fix.
- Capture logs/stack traces.

## 2. Write a failing test
- Add a test that reproduces the bug and currently fails.
- This locks in the behavior and prevents regression.

## 3. Diagnose the root cause
- Trace to the underlying cause; don't patch the surface.
- Ask "why" until you reach the real defect (5 Whys). Note if it's a class of bug.

## 4. Fix
- Make the smallest change that fixes the root cause.
- Branch: `fix/<short-description>`.
- Watch for the same bug elsewhere (same pattern, copy-pasted code).

## 5. Verify
- The new test passes; the full suite stays green.
- Manually confirm the original reproduction is resolved.
- Check for regressions in adjacent behavior.

## 6. Review & ship
- PR references the issue and explains root cause + fix.
- Follow [code-review](./code-review.md) and [deployment](./deployment.md).
- For production incidents, consider a hotfix branch and an expedited path.

## 7. Prevent recurrence
- If it's a recurring class, add a lint rule, type, or guard.
- Note anything worth a postmortem for severe incidents.

## Definition of done
- [ ] Root cause identified (not just symptom).
- [ ] Regression test added and passing.
- [ ] Fix verified against original reproduction.
- [ ] Similar occurrences checked.
- [ ] Reviewed, merged, deployed.
