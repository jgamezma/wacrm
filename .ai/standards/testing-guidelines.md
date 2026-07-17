# Testing Guidelines

## Philosophy

- Test **behavior**, not implementation. Tests should survive refactors.
- Follow the testing pyramid: many fast unit tests, fewer integration tests, a handful of E2E.
- A bug fix starts with a failing test that reproduces it.

## What to test

- **Unit** — pure logic, edge cases, error paths. No network, no DB, no filesystem.
- **Integration** — modules working together: API + DB, service + external adapter (mocked at
  the boundary).
- **E2E** — critical user journeys only (login, checkout, the money path).

## Structure

- Arrange–Act–Assert. One logical assertion per test.
- Test names describe behavior: `test_returns_404_when_user_missing`.
- Keep tests independent and order-agnostic. No shared mutable state.
- Use factories/fixtures for test data; avoid hard-coded magic values.

## Coverage

- Aim for meaningful coverage of business logic, not a percentage target for its own sake.
- New code must ship with tests. PRs that lower coverage on changed lines get pushback.
- Always cover: happy path, boundary conditions, and at least one failure/error case.

## Practices

- Tests must be deterministic — no reliance on real time, random, or network. Freeze/mocking.
- Fast: the unit suite runs in seconds. Slow tests belong in a separate CI stage.
- Mock at the system boundary (HTTP client, clock), not internal functions.
- Clean up resources; integration tests run against an ephemeral/transactional DB.

## Tooling by stack

- **Python:** `pytest`, `pytest-asyncio`, `httpx` for API tests, `factory_boy` for fixtures.
- **TypeScript/Next.js:** `vitest`/`jest` + Testing Library for units, `playwright` for E2E.

## CI

- The full suite runs on every PR and must be green to merge.
- Flaky tests are bugs — quarantine and fix, don't retry-until-green.
