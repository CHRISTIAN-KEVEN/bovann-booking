# Implementation progress

## Phase 1 — Foundations ✅ (2026-11-08)

**Objective:** a repository where the rest of the product can be built safely: database schema with integrity rules, API and web skeletons, automated checks.

### Delivered

- pnpm monorepo: `apps/api` (NestJS 11), `apps/web` (Next.js 16), `packages/shared`
- MySQL schema: 16 `t_` tables in one migration, with FKs, CHECKs, and the unique slot lock; tested to apply, roll back and re-apply
- Idempotent seed: studio, hours, 4 packages × 2 modes at the agreed prices
- API: validated environment config (refuses to start if misconfigured), MySQL connection pinned to UTC, structured JSON logs that never log credentials or phone numbers, security headers (helmet), CORS allow-list, graceful shutdown, `/health/live` and `/health/ready` (503 when the database is down)
- Web: Next.js app with the approved design tokens, self-hosted fonts, French, brand header and landing hero
- Dev services: `infra/docker-compose.dev.yml` (MySQL 8 + Mailpit to catch emails locally)
- CI (GitHub Actions): format, lint, typecheck, migrations round-trip, unit + integration tests against MySQL 8, builds

### Tests (27, all passing)

- **Database integrity (real MySQL):** double booking rejected; a multi-slot hold rolls back entirely if one slot is taken; 8 concurrent holds on one slot → exactly 1 succeeds; occupancy can't point at a slot outside its booking; block + booking on the same occupancy refused; blocked slot can't be booked; totals must add up; package booking requires a package; pending booking requires a hold expiry; phone format; one current price per package/mode; full-day package can't have a fixed size; one succeeded payment per booking; an owner email can't be queued twice; times round-trip in UTC
- API health endpoints against real MySQL; health service and env validation unit tests
- Shared money formatting and discount maths

### Not in Phase 1 (by design)

- No booking, availability, payment, admin or notification logic yet (Phases 2–6)
- The home page shows the landing hero and "La réservation en ligne ouvre très bientôt"; the booking screens come in Phase 3
- Production Dockerfiles and VPS deployment come in Phase 8

## Next: Phase 2 — Availability & pricing engine

Slot generation from opening hours, closures, lead time and horizon; month and day availability; which package start times fit; price calculation with discounts; "longer package must be cheaper per slot" validation. Pure domain code with extensive unit tests, exposed through read-only API endpoints.

## Known issues / technical debt

- TypeScript table types are maintained by hand (see architecture.md §1). Consider generating them with `kysely-codegen` in CI if drift becomes a problem.
- `ts-jest` 29 runs with Jest 30. Works today; move to ts-jest 30 when it is released.
