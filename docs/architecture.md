# Architecture & data model

_Approved 2026-11-08 · updated through Phase 6 (see §10 for what changed in Phase 1 and why)_

## 1. Technical decisions

| Area          | Decision                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Next.js 16 (TypeScript, App Router): customer booking site + admin, mobile-first, French first; CSS Modules + design tokens; self-hosted fonts |
| Backend       | NestJS 11 (TypeScript) REST API under `/api/v1`; business logic in services, never in controllers                                              |
| Database      | MySQL 8 (InnoDB, utf8mb4); all tables prefixed `t_`                                                                                            |
| DB access     | **Kysely** (type-safe SQL query builder) + **plain-SQL migrations**; the database schema is the source of truth                                |
| Calendar      | One shared calendar per space: in-studio and virtual bookings compete for the same slots                                                       |
| Notifications | Outbox table + worker; email to space owners on every confirmed booking                                                                        |
| Hosting       | One VPS + Docker Compose, reverse proxy with automatic TLS, nightly off-site DB backups                                                        |
| Payments      | Provider-agnostic module; launch provider chosen from Hub2 / FedaPay / PayDunya                                                                |
| Code          | GitHub monorepo (pnpm workspaces), CI on every push and pull request                                                                           |

### Why Kysely rather than an ORM such as Prisma or TypeORM

Our critical rules live in the database: composite foreign keys, CHECK constraints, generated columns used for "only one current row" rules. Kysely lets us write exactly that SQL in migrations and still query with full TypeScript types. ORMs tend to hide or fight these MySQL features. Trade-off: the TypeScript table types (`apps/api/src/database/schema.ts`) are maintained by hand alongside migrations, and the integration tests exercise every table through them.

## 2. Data integrity with MySQL

Bookings sit on a fixed 1h30 grid, so every bookable unit is a `(space_id, slot_start)` pair.

- `t_slot_occupancies` holds one row per currently occupied slot, with **`UNIQUE(space_id, slot_start)`**.
- Booking N slots inserts N rows in one transaction. A duplicate-key error rolls everything back, and the API answers `409 Créneau indisponible`.
- **Proven by test:** 8 concurrent holds on the same slot, exactly 1 succeeds.
- Composite foreign keys guarantee an occupancy row can only point at a slot its booking really covers, in the booking's own space. Admin blocks use the same table, so a blocked slot can't be booked.
- Trade-off: grid changes (slot duration, hours) that would conflict with future confirmed bookings are refused by the admin service.

MySQL specifics we work around:

- **No partial unique indexes.** "Only one current price per package and mode" and "only one succeeded payment per booking" use a STORED generated column (1 in that state, NULL otherwise) inside a UNIQUE index.
- **CHECK constraints can't use columns that have cascading foreign-key actions.** Those foreign keys use RESTRICT, and the application releases rows explicitly.
- **DDL is not transactional.** A migration that fails halfway can leave partial tables, so migrations are tested apply → rollback → re-apply in CI before reaching any shared environment.

## 3. Components

```
apps/web        Next.js: customer flow (Phase 3b: /, /reserver/*, /reservation/[ref]) +
                admin (Phase 5b: /admin/connexion, /admin/mot-de-passe, /admin/(app)/*)
apps/api        NestJS: config, database, health (Phase 1) · availability + catalog (Phase 2) ·
                booking, payment, customer, admin-auth, notification (Phases 3–6)
packages/shared Domain enums, French labels, money helpers shared by API and web
infra/          docker-compose (dev today; prod in Phase 8), MySQL init scripts
docs/           This documentation (mirrored in the claude.ai project)
```

## 4. Data model (MySQL, prefix `t_`)

Times are stored in UTC (`DATETIME(3)`; the connection forces `time_zone = '+00:00'`). Each space has an IANA timezone (`Africa/Lome`). Money is integer XOF.

| Table                             | Purpose                                                                                                                           | Key integrity rules                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `t_spaces`                        | A bookable studio, with its settings (slot length, booking lead time, horizon, hold duration, "presque complet" threshold, modes) | UNIQUE slug; slot 15–480 min; at least one mode enabled                                                           |
| `t_space_owner_recipients`        | Owner emails notified of confirmed bookings                                                                                       | UNIQUE(space, email)                                                                                              |
| `t_opening_hours`                 | Weekly hours, ISO weekday 1 = Monday … 7 = Sunday                                                                                 | UNIQUE(space, weekday); closes > opens                                                                            |
| `t_closures`                      | Exceptional closures                                                                                                              | ends > starts                                                                                                     |
| `t_packages`                      | Sellable formulas                                                                                                                 | UNIQUE(space, code); full-day ⇔ slot_count NULL                                                                   |
| `t_package_prices`                | Versioned prices per mode                                                                                                         | price > 0; **one current price per (package, mode)**                                                              |
| `t_customers`                     | Booking customers                                                                                                                 | UNIQUE phone (E.164 format checked)                                                                               |
| `t_bookings`                      | One booking: type SLOTS or PACKAGE, price snapshot, status, hold expiry, access-token hash                                        | UNIQUE reference; total = list − discount; PACKAGE ⇔ package set; pending ⇒ hold expiry; confirmed ⇒ confirmed_at |
| `t_booking_slots`                 | **Permanent** list of the slots a booking covers (kept after expiry or cancellation)                                              | PK(booking, slot)                                                                                                 |
| `t_slot_blocks`                   | Admin blocks (maintenance, private event)                                                                                         | –                                                                                                                 |
| `t_slot_occupancies`              | **Live lock** on slots                                                                                                            | **UNIQUE(space, slot)**; owned by exactly one booking or block; composite FKs as described in §2                  |
| `t_payments`                      | Payment attempts                                                                                                                  | UNIQUE idempotency key; UNIQUE(provider, provider_ref); **one success per booking**                               |
| `t_payment_events`                | Raw provider webhooks                                                                                                             | UNIQUE(provider, event id): idempotent processing                                                                 |
| `t_notifications`                 | Outbox of emails/SMS/WhatsApp                                                                                                     | **UNIQUE(booking, template, recipient): never sent twice**                                                        |
| `t_admin_users`                   | Admin accounts (OWNER / STAFF)                                                                                                    | UNIQUE email                                                                                                      |
| `t_audit_log`                     | Append-only trail of sensitive actions                                                                                            | –                                                                                                                 |
| `t_schema_migrations` (+ `_lock`) | Migration bookkeeping (Kysely)                                                                                                    | –                                                                                                                 |

## 5. Booking lifecycle

1. **Hold** (at "Payer"): in one transaction, save the customer, replace the same phone's previous unpaid hold, reclaim expired holds on the requested slots, create the `PENDING_PAYMENT` booking and its `t_booking_slots`, lock the slots, record the payment attempt (`hold_expires_at = now + hold_duration_min`, default **5 min**, configurable 2–15). No penalties for unpaid attempts (decision of 2026-11-09).
2. **Pay:** initiate the payment with the provider; the customer approves (PIN or card page).
3. **Confirm:** a verified webhook (or the reconciliation job) marks the payment as succeeded and the booking `CONFIRMED`, idempotently. **In the same transaction** it writes the owner email (and customer confirmation) to `t_notifications`.
4. **Expire:** the job marks unpaid holds `EXPIRED` and deletes their occupancies. `t_booking_slots` keeps the history.
5. **Late payment:** re-acquire the slots if still free; otherwise flag the booking for refund and alert the owners.
6. **Customer cancel or payment failure:** `CANCELLED`, slots freed at once.
7. **Cancel after confirmation (studio, Phase 5):** `CANCELLED`, slots freed at once; if money was received, `refund_status = DUE` with the amount to give back. Once the studio has refunded by hand: `refund_status = DONE`, booking `REFUNDED`. Customer-facing cancellation policy still TBD.
8. **Studio booking (Phase 5):** created `CONFIRMED` directly (`source = ADMIN`, `created_by_admin_id`), same slot locks as online bookings, with a `manual` payment record when paid.

## 6. Seed data (`pnpm db:seed`, idempotent)

- Space "Studio principal — Lomé" (`studio-principal-lome`), Africa/Lome, both modes, slot 1h30
- Hours 08:00–21:30 every day (assumption to confirm)
- Packages: Créneau unique 15 000 · Pack 3h (2 slots) 27 000 · Pack 6h (4 slots) 51 000 · Journée 108 000, same price for both modes
- Owner recipients from `SEED_OWNER_EMAILS` (none invented)

## 7. Delivery phases

| #   | Phase                                                                              | Status                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------- |
| 0   | Discovery & design                                                                 | ✅ Done                   |
| 1   | Foundations: monorepo, MySQL schema, seed, API skeleton + health, web skeleton, CI | ✅ Done (see progress.md) |
| 2   | Availability & pricing engine                                                      | ✅ Done                   |
| 3   | Booking API (3a) + customer screens (3b)                                           | ✅ Done                   |
| 4   | Payments                                                                           | Waiting for provider      |
| 5   | Admin: API (5a) + screens (5b)                                                     | In review                 |
| 6   | Notifications (email)                                                              | In review                 |
| 7   | Hardening                                                                          | –                         |
| 8   | Deployment                                                                         | –                         |

## 8. API

Public endpoints, error format and availability rules: see `api.md`.

## 9. Open questions

- Customer-facing cancellation and refund policy
- SMS/WhatsApp provider; transactional email provider (needs a sending domain with SPF/DKIM)
- Exact opening hours

## 10. Changes made during Phase 1 (vs. the version approved on 2026-11-08)

None of these changes alter an agreed requirement; they make the agreed design implementable and safer.

1. **Added `t_booking_slots`.** The approved design lets a customer pick several separate single slots (e.g. 08:00 and 20:00) in one booking, so a booking isn't always one continuous time range. This table records exactly which slots a booking covers, permanently. `t_slot_occupancies` remains the live lock.
2. **Added `booking_type` (SLOTS / PACKAGE)** to `t_bookings`, with a CHECK tying it to `package_id`.
3. **Full-day packages have no fixed slot count** (`slot_count` NULL). The number of slots depends on that day's opening hours.
4. **`hold_duration_min` is a per-space setting** (default 10) instead of a hard-coded value.
5. **Database access with Kysely + SQL migrations** (rationale in §1).
6. **Migration bookkeeping tables renamed** to `t_schema_migrations` / `t_schema_migrations_lock` to respect the `t_` prefix rule.

## 11. Changes made in Phase 3a (approved by the product owner on 2026-11-08)

1. **Hold duration 5 minutes** (was 10), adjustable 2–15; the hold starts at "Payer", not when slots are picked.
2. **Anti-abuse rules** and the `t_booking_policy` table.
3. **`t_bookings.client_fingerprint`** (HMAC of the IP, never the IP) and **`access_token_hash`**.
4. **Customer records:** latest details win for a returning phone number.
5. **Locking strategy:** transactions lock real rows only (customer record, specific bookings) and retry deadlock victims, after a stress test exposed deadlocks with "no rows" range locks.

## 12. Changes made in Phase 3b

1. **Anti-abuse penalties removed** at the product owner's request (2026-11-09). Migration `004` drops `t_booking_policy` and `t_bookings.client_fingerprint`. Kept: 5-minute hold (configurable), immediate release on failure or cancel, one unpaid hold per phone (a retry replaces it), request rate limit, optional Turnstile.
2. **`holdSecondsLeft`** added to the booking DTO: the payment countdown uses the server's clock, not the customer's device.
3. **Web app structure:** client components per step; progress kept in `sessionStorage` (survives reloads, never outlives the tab); booking access tokens kept in `localStorage` so the confirmation page can be reopened from the same browser.

## 13. Phase 5 (admin), decisions of 2026-11-09

1. **Sessions in the database, not self-contained tokens (JWT).**
   - `t_admin_sessions` stores the SHA-256 of a random 256-bit token. The browser holds the token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
   - Why: logout, deactivating an account, a password change or reset take effect immediately. A JWT would stay valid until it expires.
   - Sessions end after 12 h without activity and in any case after 7 days.
2. **Passwords.**
   - Hashed with Argon2id at OWASP parameters; the parameters are stored in each hash, so they can be raised later.
   - At least 10 characters.
   - The account locks for 15 minutes after 5 wrong passwords in a row.
   - Sign-in attempts are limited to 10 per minute per connection (`ADMIN_LOGIN_RATE_LIMIT_PER_MIN`).
   - An unknown email takes as long to refuse as a wrong password.
3. **CSRF protection.**
   - Every state-changing admin request must carry the `X-Bovann-Admin` header. Browsers only let another site send custom headers if CORS allows that site, and CORS allows only our own web origins.
   - The cookie is also `SameSite=Lax`.
4. **Roles** are enforced per endpoint by `AdminAuthGuard` with `@Roles('OWNER')`; the default is any signed-in admin. There is always at least one active administrator: the owner rows are locked while roles change.
5. **Shared write steps.** Online and studio bookings use the same write steps (`booking-writes.ts`): upsert the customer, reclaim expired holds, insert with a unique reference, lock the slots. So the rule "a slot is held by one booking or block" has one implementation.
6. **Settings changes never silently break a confirmed booking.**
   - New opening hours or a closure that would exclude an active booking are refused (409), with the list of affected bookings. The studio cancels or moves them first.
   - The slot duration can't be edited for now; it stays 1h30.
7. **Prices are versioned.** A change closes the current `t_package_prices` row and opens a new one, effective immediately. Every save is checked against the price ladder: each package must be cheaper per slot than any shorter one, and cheaper than buying its slots one by one.
8. **Migration `005`:**
   - `t_admin_sessions`
   - on `t_admin_users`: lockout fields and `must_change_password`
   - on `t_bookings`: `source`, `created_by_admin_id`, `cancelled_by_admin_id`, `admin_note`, and refund fields (`refund_status`, `refund_amount_xof`, `refunded_at`, `refunded_by_admin_id`, `refund_note`) with CHECK constraints
   - `t_payments.method` gains `CASH`, `BANK_TRANSFER` and `OTHER`, plus `recorded_by_admin_id` and `note`
9. **Admin web app (5b).**
   - Client components under `/admin`. The `(app)` route group wraps every signed-in page in `AdminShell`: it checks the session, redirects to sign-in or to the password change, loads the spaces (selection remembered in the browser), and holds the menu.
   - API calls go through `lib/admin-api.ts`, which sends credentials and the CSRF header; any 401 sends the admin back to sign-in.
   - Dialogs use the native `<dialog>` element, so focus is trapped and Escape closes.
   - The screens never decide what is allowed: they hide what the role can't do, and the API enforces it.
10. **Hosting note for Phase 8:** serve the website and the API from the same site (e.g. `reservation.bovann.tg` with the API under `/api`, or `api.` on the same domain), so the session cookie stays first-party.

## 14. Phase 6 (emails), decisions of 2026-11-09

1. **Outbox, delivered by a worker.**
   - Every email is written to `t_notifications` in the same transaction as the booking change it reports (confirmation, cancellation, late payment), so none can be lost or sent for a change that was rolled back. Each email row can exist only once per booking, template and recipient.
   - `NotificationWorker` sends what is due every 15 s (`NOTIFICATION_INTERVAL_SEC`). It claims rows with `FOR UPDATE SKIP LOCKED`, so it is safe with several API instances.
2. **Retries.**
   - A failure is retried after 1, 2, 5, 15, 30, 60, 120 and 240 minutes (about 8 h); then the email is `FAILED`.
   - An address refused for good (SMTP 550/551/553, bad envelope) fails at once. Quota and temporary errors (4xx, 5.4.x) are retried.
   - An email left `SENDING` by a crash is picked up again after 10 minutes. While `SENDING`, `next_attempt_at` holds the claim time.
   - The admin shows each booking's emails and their state, with "Renvoyer" for a failed one.
3. **Plain SMTP (nodemailer), behind a small `Mailer` interface.**
   - Gmail now, Brevo or another provider later, Mailpit in development: only settings change.
   - With `EMAIL_TRANSPORT=disabled` (tests, or no provider yet) emails stay queued and are sent once configured.
   - Production refuses to start without sending configured, because owners must hear about every booking.
4. **The payload is frozen.** The email content is captured when the email is queued, in the same transaction. Fields added in Phase 6 are optional, so older queued emails still render.
5. **Templates** are French, with an HTML body (tables and inline styles, which every mail client supports) and a plain-text body. Every value from the database is HTML-escaped. Logs never contain recipients, only the email's id, template and the provider's error.
6. **Test email:** an administrator can send a test from Paramètres; the provider's error, if any, is shown as is (for example "535 Username and Password not accepted").
7. **SMS / WhatsApp** use the same outbox (`channel` column) once a provider is chosen.
