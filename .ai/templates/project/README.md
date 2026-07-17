# Base project template

The stack-agnostic foundation every project gets. Stack templates
(`backend-fastapi`, `frontend-nextjs`, `fullstack-nextjs-fastapi`) build on top of this.

## What it ships

Into the project root:
- `CLAUDE.md` — Claude Code entry point (imports the `.ai/` content).
- `AGENTS.md` — cross-tool agent instructions (Cursor + others).
- `.cursor/rules/core.mdc` — Cursor rules.

Into `.ai/`:
- `project-context.md`, `architecture.md` — **project-owned scaffolds** you fill in. Never
  overwritten by `sync update`.
- `standards/`, `roles/`, `workflows/` — **shared, version-stamped** copies from the library.
  Updated by `sync update` unless you've modified them locally.

## Use it

```bash
# from the library root
scripts/sync-template.sh init project /path/to/my-project
```

Then open `/path/to/my-project/.ai/project-context.md` and `.ai/architecture.md` and fill in
the TODOs.

## Update later

```bash
scripts/sync-template.sh check  /path/to/my-project   # dry run
scripts/sync-template.sh update /path/to/my-project   # apply
```

See the [top-level README](../../README.md) for the full sync model.
