# Workflow: Deployment

Deploys should be boring, automated, and reversible. Owned by **DevOps** but everyone follows it.

## Pre-deploy checklist
- [ ] All CI green on `main`: tests, lint, type-check, security scan.
- [ ] Migrations are backward-compatible (see [database-guidelines](../standards/database-guidelines.md)).
- [ ] Feature flags configured if shipping behind a flag.
- [ ] Rollback plan known; previous version deployable.
- [ ] Observability ready: dashboards/alerts cover new surfaces.

## Environments
Promote through: **dev → staging → production**. Never skip staging for non-trivial changes.
Environments are as identical as possible (config differs, not topology).

## Deploy steps
1. Deploy to **staging**; run smoke/E2E tests against it.
2. Verify health checks and key metrics on staging.
3. Deploy to **production** using a zero-downtime strategy (rolling / blue-green / canary).
4. Run post-deploy smoke tests on production.

## Database migrations (zero-downtime)
Follow the expand/contract pattern:
1. Deploy backward-compatible schema (add nullable/new table).
2. Backfill data.
3. Deploy code that uses the new schema.
4. In a later release, remove old columns / add constraints.

Never couple a destructive migration with the deploy that stops using the old column.

## Post-deploy
- Watch error rate, latency, and saturation for the bake period.
- Confirm the feature works in production (real user path).
- Announce completion; update the changelog/release notes.

## Rollback
- If health checks or key metrics degrade: **roll back first, investigate after.**
- One-command rollback to the previous release. Migrations must not block rollback (that's why
  they're backward-compatible).

## Incident response
- Declare an incident for user-facing degradation.
- Mitigate (rollback/flag off) → communicate → root-cause → postmortem for severe cases.
