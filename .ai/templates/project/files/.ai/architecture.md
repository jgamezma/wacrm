# Architecture

> **Project-owned file.** Fill this in and keep it current as the system evolves.
> The sync script never overwrites it.

## System overview

<!-- A short prose description + a diagram (ASCII/mermaid) of the main components. -->
TODO

```
[ client ] -> [ api ] -> [ db ]
```

## Components

| Component | Responsibility | Tech |
|-----------|----------------|------|
| TODO | TODO | TODO |

## Data model

<!-- Core entities and relationships. Link to migrations/schema. -->
TODO

## Key flows

<!-- Walk through the critical paths (e.g. auth, the money path). -->
1. TODO

## Technology choices

| Area | Choice | Why |
|------|--------|-----|
| Language/framework | TODO | TODO |
| Database | TODO | TODO |
| Hosting/infra | TODO | TODO |

## Cross-cutting concerns

- **AuthN/AuthZ:** TODO
- **Observability:** TODO (logging, metrics, tracing)
- **Error handling:** TODO
- **Caching:** TODO

## Architecture Decision Records (ADRs)

<!-- One line per decision; link to a fuller ADR if it warrants one. -->
- **ADR-001** — TODO: context → decision → consequences

## Known risks & tech debt

- TODO
