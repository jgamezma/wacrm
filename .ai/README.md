# ai-dev-template-library

A shared, versioned library of **AI development context** for every project at IdeasLab.
It defines *who* the AI acts as (roles), *how* work flows (workflows), and *what rules apply*
(standards) — and ships them into each project as native config files that Claude Code and
Cursor read automatically.

## Why this exists

Every project re-invents its AI conventions from scratch, and improvements never propagate
back to older repos. This library is the **single source of truth**. You scaffold a project
from a template, and later run `sync` to pull in improvements — without ever clobbering the
customizations a project has made.

## How it's structured

```
ai-dev-template-library/
├── VERSION                    # library version (semver)
├── CHANGELOG.md               # what changed between versions
│
├── standards/                 # SHARED, STABLE rules — the source of truth
│   ├── coding-standards.md
│   ├── git-conventions.md
│   ├── api-guidelines.md
│   ├── database-guidelines.md
│   ├── testing-guidelines.md
│   └── security-guidelines.md
│
├── roles/                     # personas the AI can adopt
│   ├── software-architect.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   ├── product-owner.md
│   ├── devops-engineer.md
│   ├── qa-engineer.md
│   └── security-reviewer.md
│
├── workflows/                 # step-by-step processes
│   ├── feature-development.md
│   ├── bug-fix.md
│   ├── code-review.md
│   ├── refactor.md
│   └── deployment.md
│
├── templates/                 # what gets copied INTO a project
│   ├── project/               # base, stack-agnostic
│   ├── backend-fastapi/
│   ├── frontend-nextjs/
│   └── fullstack-nextjs-fastapi/
│
└── scripts/
    ├── sync-template.sh       # scaffold + update projects
    └── lib/common.sh
```

### Key idea: standards vs. context

- **Standards / roles / workflows** are shared and live in the library. They are *copied* into
  each project (under `.ai/`) and version-stamped, so the sync script can update them safely.
- **Project context** (`.ai/project-context.md`, `.ai/architecture.md`) is *per-project*. The
  template ships an empty scaffold with prompts to fill in; sync never overwrites it.

### Tool integration

When a project is scaffolded it gets:

- **`CLAUDE.md`** — read automatically by Claude Code. Uses `@`-imports to pull in the copied
  standards, roles, and workflows.
- **`.cursor/rules/*.mdc`** — read automatically by Cursor.
- **`AGENTS.md`** — the cross-tool open standard, for any other agent.

All three reference the same underlying `.ai/` content, so there is one source of truth per
project and no duplicated rules.

## Usage

### Scaffold a new project

```bash
scripts/sync-template.sh init fullstack-nextjs-fastapi /path/to/my-project
```

### Update an existing project to the latest library version

```bash
scripts/sync-template.sh update /path/to/my-project
```

`update` compares each managed file against the copy recorded in the project's
`.ai/.template-manifest.yaml`:

- **Unchanged locally + newer upstream** → updated automatically.
- **Modified locally** → shows a diff and asks before touching it. Your edits win by default.

### Check what would change (dry run)

```bash
scripts/sync-template.sh check /path/to/my-project
```

## Versioning

The library follows semver (`VERSION`). Bump it and record the change in `CHANGELOG.md`
whenever you edit anything under `standards/`, `roles/`, `workflows/`, or `templates/`.
Projects compare against this number to decide what to sync.

## Contributing

1. Edit the source files under `standards/`, `roles/`, `workflows/`, or `templates/`.
2. Bump `VERSION` and add a `CHANGELOG.md` entry.
3. Keep it lean — a stale template is worse than a missing one. Only add a role or workflow
   you are prepared to maintain.
