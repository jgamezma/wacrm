# Security Guidelines

Security is everyone's job, not a final gate. Apply these on every change.

## Secrets

- Never commit secrets. Use the secret manager / environment variables.
- `.env` is git-ignored and never shared in chat, tickets, or logs.
- Rotate credentials on any suspected exposure. No long-lived static keys where avoidable.

## Authentication & authorization

- Authenticate every non-public endpoint. Authorize every action against the actor's permissions.
- Check authorization at the resource level (can *this* user touch *this* record?), not just route level.
- Sessions/tokens: short-lived access tokens, secure refresh flow, `HttpOnly`+`Secure`+`SameSite` cookies.
- Hash passwords with a strong adaptive algorithm (argon2/bcrypt). Never store plaintext or reversible.

## Input & output

- Validate and sanitize all external input at the boundary (body, query, headers, files).
- Parameterized queries only — no string-built SQL (see [database-guidelines](./database-guidelines.md)).
- Encode output for its context to prevent XSS. Prefer framework auto-escaping.
- Enforce size/type limits on uploads; store outside the web root; scan where appropriate.

## Transport & headers

- HTTPS everywhere; HSTS on. No sensitive data in URLs (they land in logs/history).
- Set security headers: CSP, `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors, referrer policy.
- Lock CORS to known origins. No wildcard with credentials.

## Data protection

- Encrypt sensitive data at rest; TLS in transit.
- Log actions and errors, but never log secrets, tokens, passwords, or full PII.
- Apply data minimization and retention limits. Know where PII lives.

## Dependencies & supply chain

- Pin dependencies; run automated vulnerability scanning (dependabot / audit) in CI.
- Review new dependencies before adding. Prefer well-maintained, widely-used packages.

## Rate limiting & abuse

- Rate-limit auth, write, and expensive endpoints. Return `429` with `Retry-After`.
- Add idempotency to critical writes to prevent duplicate side effects.

## Review checklist (see also [security-reviewer role](../roles/security-reviewer.md))

- [ ] No secrets in diff.
- [ ] AuthN + AuthZ enforced on new/changed endpoints.
- [ ] All input validated; all output encoded.
- [ ] No injection vectors (SQL, command, template, path traversal).
- [ ] Errors don't leak internals; sensitive data not logged.
- [ ] New dependencies vetted.
