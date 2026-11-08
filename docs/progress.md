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

### Tests (32, all passing: 27 API, 5 shared)

- **Database integrity (real MySQL):** double booking rejected; a multi-slot hold rolls back entirely if one slot is taken; 8 concurrent holds on one slot → exactly 1 succeeds; occupancy can't point at a slot outside its booking; block + booking on the same occupancy refused; blocked slot can't be booked; totals must add up; package booking requires a package; pending booking requires a hold expiry; phone format; one current price per package/mode; full-day package can't have a fixed size; one succeeded payment per booking; an owner email can't be queued twice; times round-trip in UTC
- API health endpoints against real MySQL; health service and env validation unit tests
- Shared money formatting and discount maths

### Not in Phase 1 (by design)

- No booking, availability, payment, admin or notification logic yet (Phases 2–6)
- The home page shows the landing hero and "La réservation en ligne ouvre très bientôt"; the booking screens come in Phase 3
- Production Dockerfiles and VPS deployment come in Phase 8

## Phase 2 — Availability & pricing engine ✅ (2026-11-08)

**Objective:** the system computes correctly what can be booked and at what price. Nothing can be booked yet (Phase 3).

### Delivered

- **Domain rules** (`apps/api/src/availability/domain`, pure functions, no database or clock):
  - time-zone-safe calendar helpers (Lomé today, any IANA zone later, daylight saving handled)
  - slot grid from opening hours
  - slot statuses: closures, 1-hour lead time, 90-day horizon, bookings, admin blocks; expired holds count as free
  - day status for the calendar: available / presque complet (≤ 3 left) / complet / fermé / passé / hors période
  - package start options (N consecutive free slots) and the full-day rule
  - price quotes with discount
  - price-ladder validation (longer = cheaper per slot), ready for the admin in Phase 5
- **API** (documented in `docs/api.md`):
  - `GET /api/v1/spaces/:slug`
  - `GET /api/v1/spaces/:slug/packages?mode=`
  - `GET /api/v1/spaces/:slug/availability?month=`
  - `GET /api/v1/spaces/:slug/availability/:date?mode=`
  - unified error format with French messages
  - injectable clock
- **Database:** migration `002` adds `t_spaces.few_slots_threshold` (default 3)
- **CI:** GitHub Actions updated to current versions; runner pinned to Ubuntu 24.04

### Tests (88, all passing: 83 API, 5 shared)

- 37 domain unit tests: time zones (Lomé, Lagos, Paris summer/winter), month and leap years, slot grid, closing time, lead time, horizon, partial and full closures, booked/blocked slots, presque complet / complet / passé, package fit including the exact scenario of the approved design, full day, quotes, price ladder
- 19 HTTP tests against MySQL with a frozen clock: space details, packages and discounts, month calendar (past days, booked day, expired hold counted as free, admin block, closure), day detail (slot statuses, Pack 6h only at 12:30–18:30, full day rules), validation errors, mode not offered

## Next: Phase 3 — Booking API + customer screens

- Hold flow: create the booking and lock its slots in one transaction (expired holds reclaimed); `409 Créneau indisponible` on a race
- Expiry job releasing unpaid holds
- Customer details capture with validation
- The 6 approved customer screens wired to the API, with loading, empty and error states
- Booking without real payment until Phase 4 (payment step stubbed behind the gateway interface)

## Known issues / technical debt

- TypeScript table types are maintained by hand (see architecture.md §1). Consider generating them with `kysely-codegen` in CI if drift becomes a problem.
- `ts-jest` 29 runs with Jest 30. Works today; move to ts-jest 30 when it is released.
- The seed dates prices from the moment it runs (`valid_from = now`). Fine in practice; tests backdate them because they freeze the clock earlier.
