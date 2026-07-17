# API Guidelines

Applies to all HTTP APIs (default: REST/JSON).

## Design

- Resource-oriented URLs, plural nouns: `/users`, `/users/{id}/orders`.
- Use HTTP verbs correctly: `GET` (read, safe), `POST` (create), `PUT`/`PATCH` (update),
  `DELETE` (remove). `GET` and `DELETE` carry no body.
- Version at the base path: `/api/v1/...`. Never break a published version.
- Filtering, sorting, pagination via query params: `?status=active&sort=-created_at&page=2&limit=20`.

## Status codes

| Code | Use |
|------|-----|
| 200 | OK (read/update) |
| 201 | Created (include `Location` header) |
| 204 | No content (successful delete) |
| 400 | Validation / malformed request |
| 401 | Not authenticated |
| 403 | Authenticated but not allowed |
| 404 | Resource not found |
| 409 | Conflict (duplicate, version mismatch) |
| 422 | Semantically invalid input |
| 429 | Rate limited |
| 5xx | Server error — never leak internals |

## Request/response shape

- JSON only. `snake_case` or `camelCase` — pick one per project and never mix.
- Wrap collections with pagination metadata:
  ```json
  { "data": [...], "meta": { "page": 1, "limit": 20, "total": 137 } }
  ```
- Consistent error envelope:
  ```json
  { "error": { "code": "validation_error", "message": "Email is required", "details": [...] } }
  ```
- Never return raw stack traces or internal identifiers in errors.

## Contracts & docs

- Every endpoint has an OpenAPI definition (FastAPI generates this — keep it accurate).
- Validate all input with a schema (Pydantic / Zod). Reject unknown fields where it matters.
- Breaking changes require a new version, not a silent mutation.

## Reliability

- Make writes idempotent where possible (idempotency keys for payments/critical POSTs).
- Set sensible timeouts and return `429` with `Retry-After` when rate limiting.
- Paginate anything that can grow unbounded. No "return all rows" endpoints.

## Security

See [security-guidelines](./security-guidelines.md): authn/authz on every non-public route,
input validation, output encoding, no sensitive data in URLs or logs.
