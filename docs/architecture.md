# Architecture & data model

_Approved 2026-11-08 · updated at the end of Phase 1 (see §9 for what changed and why)_

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
apps/web        Next.js: customer flow + /admin
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
| `t_bookings`                      | One booking: type SLOTS or PACKAGE, price snapshot, status, hold expiry                                                           | UNIQUE reference; total = list − discount; PACKAGE ⇔ package set; pending ⇒ hold expiry; confirmed ⇒ confirmed_at |
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

1. **Hold:** in one transaction, free expired holds on the requested slots, create the `PENDING_PAYMENT` booking and its `t_booking_slots`, insert the occupancies (`hold_expires_at = now + hold_duration_min`, default 10 min).
2. **Pay:** initiate the payment with the provider; the customer approves (PIN or card page).
3. **Confirm:** a verified webhook (or the reconciliation job) marks the payment as succeeded and the booking `CONFIRMED`, idempotently. **In the same transaction** it writes the owner email (and customer confirmation) to `t_notifications`.
4. **Expire:** the job marks unpaid holds `EXPIRED` and deletes their occupancies. `t_booking_slots` keeps the history.
5. **Late payment:** re-acquire the slots if still free; otherwise flag the booking for refund and alert the owners.
6. **Cancel / refund:** policy TBD.

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
| 3   | Booking API + customer screens                                                     | Next                      |
| 4   | Payments                                                                           | –                         |
| 5   | Admin                                                                              | –                         |
| 6   | Notifications                                                                      | –                         |
| 7   | Hardening                                                                          | –                         |
| 8   | Deployment                                                                         | –                         |

## 8. API

Public endpoints, error format and availability rules: see `api.md`.

## 9. Open questions

- Cancellation and refund policy
- SMS/WhatsApp provider; transactional email provider (needs a sending domain with SPF/DKIM)
- Exact opening hours
- Admin roles: is OWNER vs STAFF enough?

## 10. Changes made during Phase 1 (vs. the version approved on 2026-11-08)

None of these changes alter an agreed requirement; they make the agreed design implementable and safer.

1. **Added `t_booking_slots`.** The approved design lets a customer pick several separate single slots (e.g. 08:00 and 20:00) in one booking, so a booking isn't always one continuous time range. This table records exactly which slots a booking covers, permanently. `t_slot_occupancies` remains the live lock.
2. **Added `booking_type` (SLOTS / PACKAGE)** to `t_bookings`, with a CHECK tying it to `package_id`.
3. **Full-day packages have no fixed slot count** (`slot_count` NULL). The number of slots depends on that day's opening hours.
4. **`hold_duration_min` is a per-space setting** (default 10) instead of a hard-coded value.
5. **Database access with Kysely + SQL migrations** (rationale in §1).
6. **Migration bookkeeping tables renamed** to `t_schema_migrations` / `t_schema_migrations_lock` to respect the `t_` prefix rule.
