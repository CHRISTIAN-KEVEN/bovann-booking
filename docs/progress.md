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

## Phase 3a — Booking engine (API) ✅ (2026-11-09)

**Objective:** customers can hold slots and book them safely, with the anti-abuse rules approved on 2026-11-08. Payment is simulated until Phase 4.

### Delivered

- `POST /api/v1/bookings` ("Payer"), `GET /api/v1/bookings/:reference`, `POST /api/v1/bookings/:reference/cancel`, plus the development-only payment simulator (see `docs/api.md`)
- **Hold for 5 minutes**, started only at "Payer"; slots freed immediately on cancel or payment failure; expired holds count as free right away; a cleanup job marks them every 30 s
- **Atomic slot lock:** one transaction saves the customer, replaces the same phone's previous hold, reclaims expired holds, creates the booking, locks the slots and records the payment attempt
- **Anti-abuse rules** (1 hold per phone, limits per connection, 24 h cooldown, `t_booking_policy`). _Removed in Phase 3b at the product owner's request; see below._
- **Confirmation:** booking `CONFIRMED` and owner and customer emails queued in the same transaction (sent in Phase 6); late payments re-take the slots if free, otherwise are flagged for refund to the owners
- **Customer records:** one per phone, latest details win, existing email kept if none given
- **Payment gateway interface** with the simulated provider; production refuses to start with it
- **Privacy & security:**
  - booking access tokens stored hashed
  - wrong token = same 404 as an unknown reference
- **Migration `003`:** hold duration 2–15 min (default 5), `t_booking_policy`, `t_bookings.client_fingerprint` and `access_token_hash`

### Tests (120, all passing: 115 API, 5 shared)

- New: 22 booking HTTP tests against MySQL with a controllable clock (hold, package, 409, 6 simultaneous customers → 1 winner, validation, customer details, supersede, re-pick own slots, token, cancel, expiry before and by the job, confirm + emails queued once, failure, late payment both ways, all anti-abuse rules), 1 rate-limit test, 8 booking unit tests, 1 env test
- One-off stress run: 20 simultaneous customers on one slot, 5 runs → always exactly one winner, all others a clean 409

### Found and fixed during testing

Under heavy contention, MySQL deadlocks made some losing requests fail with a 500 (never a double booking). The transaction now locks only real rows (the customer record, then specific bookings) and retries deadlock victims with a short random delay.

## Phase 3b — Customer screens ✅ (2026-11-09)

**Objective:** the approved booking screens, connected to the real API.

### Delivered

- **Screens** (French, mobile-first, centred card on desktop):
  1. Mode
  2. Month calendar with day statuses
  3. Day: single slots / packages, start-time chips, "switch to the package and save" suggestion
  4. Details form with inline validation
  5. Payment: Mobile Money (T-Money / Flooz) or card, "Payer" holds the slots, server-driven countdown, status polling, cancel, simulated outcome buttons in demo mode
  6. Confirmation, with an "add to calendar" file
- **States:** loading skeletons; errors with "Réessayer"; no availability; slot taken just before "Payer" (back to the day, slot shown as taken); payment failed; payment time expired; network down
- **Continuity:** progress survives reloads and the back button; opening a later step directly sends the customer back to the first missing step; the confirmation page can be reopened later in the same browser
- **Accessibility:** real form controls, labels and error descriptions, `aria-pressed` chips, live regions for countdown and status, visible focus, 44 px touch targets, colours meeting WCAG AA
- **Product decision applied (2026-11-09): no anti-abuse penalties.** Migration `004` removes them; kept are the 5-minute configurable hold, immediate release on failure or cancel, one unpaid hold per phone (a retry replaces it), the request rate limit and an optional Turnstile check.
- **API:** `holdSecondsLeft` in the booking DTO, so customers' device clocks don't affect the countdown

### Tests

- **Totals:** 136 automated tests (112 API, 5 shared, 19 web)
- **Web unit tests:** French dates and Monday-first calendar, slot ranges and prices, package suggestion, flow state rules, phone composition and validation, API error mapping, token storage, calendar file
- **Web component tests:** the details form (redirect when a step is missing, French errors, saving valid details)
- **API:** 2 new tests lock in the "retry freely" decision
- **End-to-end in a real Chrome against the running API** (one-off, not yet in CI):
  - full booking from mode to confirmed, with owner and customer emails queued
  - another customer takes the slot just before "Payer" → clear message, back to the day, slot shown as taken; this also proves the shared calendar between modes
  - no browser errors and no horizontal scrolling on any screen

### Found and fixed during the visual check

- Horizontal overflow on the payment screen (browser default on form groups)
- Price wrapping in the bottom bar
- A package's slots listed separately instead of one range on the confirmation
- French punctuation spacing
- Missing site icon

## Next: Phase 4 — Payments

Real provider adapter (Hub2 / FedaPay / PayDunya, depending on Bovann Group's choice), signed webhooks, reconciliation job, card redirect flow. Needs: the provider's sandbox credentials.

## Known issues / technical debt

- TypeScript table types are maintained by hand (see architecture.md §1). Consider generating them with `kysely-codegen` in CI if drift becomes a problem.
- `ts-jest` 29 runs with Jest 30. Works today; move to ts-jest 30 when it is released.
- Booking slot end times are derived from the space's current slot duration when displayed. Changing the slot duration must be blocked while future bookings exist (admin, Phase 5).
- The end-to-end browser test was run manually (Puppeteer + Chrome). Automate it with Playwright in CI during Phase 7 (hardening).
- No terms and conditions page yet: the checkbox text refers to the studio's booking and cancellation conditions, which are still to be written (cancellation policy open question).
- The seed dates prices from the moment it runs (`valid_from = now`). Fine in practice; tests backdate them because they freeze the clock earlier.
