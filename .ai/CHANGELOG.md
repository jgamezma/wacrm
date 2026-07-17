# Changelog

All notable changes to the AI dev template library are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-07-06

### Added
- Initial library structure: `standards/`, `roles/`, `workflows/`, `templates/`, `scripts/`.
- Standards: coding, git, API, database, testing, security.
- Roles: architect, backend, frontend, product owner, devops, QA, security reviewer.
- Workflows: feature development, bug fix, code review, refactor, deployment.
- Templates: base `project/`, `backend-fastapi/`, `frontend-nextjs/`,
  `fullstack-nextjs-fastapi/` — each generating `CLAUDE.md`, `AGENTS.md`, and
  `.cursor/rules/`.
- `sync-template.sh` with `init` / `update` / `check` commands and a per-project
  version-stamped manifest for safe, non-destructive updates.
