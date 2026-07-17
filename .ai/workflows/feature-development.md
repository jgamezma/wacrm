# Workflow: Feature Development

End-to-end process for building a new feature. Roles in **bold** map to `../roles/`.

## 1. Understand (Product Owner)
- Restate the user problem and success metric.
- Write user stories with Given/When/Then acceptance criteria.
- Confirm scope; list assumptions and open questions.

## 2. Design (Software Architect)
- Define the technical approach, boundaries, data model, and API contracts.
- Write an ADR for any significant decision.
- Update `.ai/architecture.md`. Identify risks and how to de-risk.

## 3. Plan
- Break the story into small, independently mergeable tasks.
- Sequence them so each keeps `main` deployable.
- Create the branch: `feature/<short-description>`.

## 4. Build (Backend / Frontend Developer)
- Implement against the contract, boundary-in.
- Handle unhappy paths (not found, unauthorized, downstream failure).
- Write tests alongside code (unit + integration; E2E for critical flows).
- Instrument with logs/metrics.

## 5. Verify (QA Engineer)
- Exercise all acceptance criteria plus edge/negative/boundary cases.
- Automate regression-worthy scenarios.
- Check accessibility and performance where relevant.

## 6. Review (Code Review + Security Reviewer)
- Follow [code-review](./code-review.md).
- Security-sensitive changes get a [security-reviewer](../roles/security-reviewer.md) pass.

## 7. Ship (DevOps Engineer)
- Merge via squash (Conventional Commits).
- Deploy per [deployment](./deployment.md); confirm health and metrics.

## Definition of done
- [ ] Acceptance criteria met and verified.
- [ ] Tests pass; lint/type-check/security scan clean.
- [ ] Docs / `.ai/` context updated.
- [ ] Reviewed, merged, deployed, and observed healthy.
