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
| `t_booking_access_tokens`         | Extra booking access tokens from "Mes réservations" lookups (one per device)                                                      | UNIQUE token hash                                                                                                 |
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
7. **Cancel after confirmation (studio, Phase 5):** `CANCELLED`, slots freed at once; if money was received, `refund_status = DUE` with the amount to give back. Once the studio has refunded by hand: `refund_status = DONE`, booking `REFUNDED`. Customers cancel by contacting the studio (48 h rule, §15); the studio then cancels the booking this way.
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

## 15. Customer site: conditions, loaders, "Mes réservations" (2026-11-09)

1. **No customer accounts** (product-owner decision). "Retrouver ma réservation" finds a booking with its reference and phone number (`POST /bookings/lookup`). _Changed 2026-11-10:_ the page no longer lists the bookings this browser holds tokens for, because the next user of a shared device would see them.
   - Each lookup issues a new token for that device, stored hashed in `t_booking_access_tokens` (migration `006`). The device that booked keeps its own token in `t_bookings.access_token_hash`.
   - Guessing is impractical: a random 5-character code in the reference, the phone number must match, a uniform 404 and a rate limit.
   - Later, with an SMS/WhatsApp provider: a code sent to the phone can list every booking for that number, which works like an account without a password.
2. **Conditions page** (`/conditions`), linked from the details checkbox and from the footer on every page. Customer cancellation rule decided on 2026-11-09: contact the studio at least 48 h before for a full refund or a new date; later, no refund. To be reviewed by a lawyer before launch.
3. **Loaders** shaped like the content (calendar grid, slots, booking card), and buttons that call the server show a spinner and are disabled while they run.

## 16. Booking receipt (2026-11-10)

- `GET /bookings/:reference/receipt` renders a one-page A4 PDF on the API with **pdfkit**: the content comes from the same data as the confirmation email (`buildNotificationPayload`) plus the price breakdown and the successful payment, so the receipt, the email and the admin always agree.
- Built-in PDF fonts (Helvetica) keep the file small (about 3 KB) and need no font files; `pdfText` swaps the few characters they cannot draw (narrow spaces, minus sign).
- Only for `CONFIRMED` bookings, behind the booking access token. Times are shown in the studio's time zone. The simulated provider's transaction reference is hidden.
- Called "Reçu de réservation" and marked "Il ne constitue pas une facture": a formal invoice needs Bovann Group's tax details.

## 17. French and English (2026-11-10)

Product-owner decision: the whole product in French (main language) and English.

1. **Addresses.** French pages keep their plain address (`/reserver/date`); English pages are the same address under `/en` (`/en/reserver/date`). A link always opens in the language it was shared in.
   - All routes live under `app/[lang]/`. `src/proxy.ts` (Next.js 16's name for middleware) serves the plain address from the `fr` route without changing the address, and sends `/fr/…` back to the plain address so each page has one address.
   - Page paths stay French in both languages (`/en/mes-reservations`): one set of routes, and email links stay simple.
2. **Texts.** `apps/web/src/i18n/messages/fr.ts` is the reference; `en.ts` has the same keys, and TypeScript fails the build if an English text is missing. A key-equality test checks it too.
   - Client components call `useI18n()` → `{ t, locale, path }`. `t('slots.suggestText', { name, price })` fills values; texts with a count have a singular and a plural form.
   - `Link` and `useLocaleRouter` from `@/i18n/I18nProvider` keep the current language in every link and redirect.
   - Only the page's language is sent to the browser (the layout passes one dictionary).
   - Legal pages (`/conditions`) are written as two whole documents; the English one says the French text applies if they differ.
   - The FR | EN switch keeps the page and its `?ref=…`.
3. **API.** The website sends `Accept-Language: fr|en` with every call.
   - A request-context middleware (AsyncLocalStorage) makes the language available anywhere during the request: `currentLocale()`, `localized(fr, en)`.
   - **Error messages:** the error filter translates them. Plain French messages map to English through `common/messages-en.ts`; messages built with values are thrown with both languages (`{ fr, en }`). A unit test fails if a French message has no English version.
   - **Names:** spaces and packages have an optional English name (`name_en`, `description_en`), entered in the admin. The French one is shown when it is empty.
4. **Bookings remember their language** (`t_bookings.locale`), with the package's English name as it was when booked (`package_name_en`).
   - The customer's emails use the booking's language; the studio's emails stay in French.
   - The receipt follows the language of the page it is downloaded from.
5. **Migration `007`:** `t_spaces.name_en`; `t_packages.name_en`, `description_en`; `t_bookings.locale` (CHECK fr/en) and `package_name_en`. The seed fills the English names without overwriting the admin's.
6. **Admin (step 2):** every admin screen is translated the same way; the FR | EN switch sits under the account name. Admins enter the English names of packages and spaces next to the French ones. Booking history, email labels and package names in lists come from the API in the page's language.
7. **Still in French only:** business sectors, until they become the shared category list with English names.

## 18. Live directory "En direct", part 1: the wall (2026-11-10)

Product-owner decisions are in requirements.md. This part delivers what visitors see; sellers' accounts, posting and review, review hours and passes come next.

1. **Tables (migration `008`).**
   - `t_categories`: code, French and English names, icon, order, active. Eight categories seeded. "Autre" is not a row: a live then has no `category_id` and keeps the typed text in `category_other` (CHECK: exactly one of the two). The booking form moves to this list with the categories work.
   - `t_lives`: seller name, platform (ENUM TikTok/Facebook), link, country, category, duration, status (`PENDING`, `APPROVED`, `REJECTED`, `ENDED`, `REMOVED`), `starts_at`/`ends_at`, who added and who ended it, and why.
   - The database enforces: https links, an upper-case country code, name length, one category, a listed live has times with `ends_at > starts_at`, an ended or removed live has `ended_at`.
2. **No expiry job.** A live is on the wall while `status = 'APPROVED' AND starts_at <= now < ends_at` (index `status, ends_at, starts_at`). Ending early changes the status.
3. **Links are the main risk** (a listing could send visitors anywhere). One function, `checkLiveLink`, used by the API and the web form: host allow-list, https only, no credentials or ports, fragment dropped. Cards open links in a new tab with `rel="noopener noreferrer nofollow ugc"`. React escapes all text; names are cleaned of invisible characters that can disguise text.
4. **Duplicates:** the same link can't be on the wall twice. The check locks the link's rows (`FOR UPDATE` on the `url` index) inside the transaction, so two staff adding it together get one success and one 409.
5. **Web.** `/en-direct` (and `/en/en-direct`). The page loads the whole wall in one call and filters in the browser: instant filters, and country counts that match what a tap shows. The choice stays in the address (`?pays=TG&plateforme=tiktok&categorie=mode`). It fetches again every minute and when the visitor comes back to the tab. Flags are drawn in SVG (Windows shows emoji flags as letters). The header of the home page and the wall has two tabs: "En direct" and "Réserver le studio".
6. **Admin.** "Lives" page for both roles: what is online, what ended in the last 30 days, "Ajouter un live" (paste the link: platform and account are detected, the name is pre-filled) and "Retirer" with a reason. Every action is in the audit log.

## 19. Seller sign-in (2026-11-11)

Product-owner decision: sellers sign in with their phone number and a code sent by WhatsApp or SMS; the code sign-in is built before posting, even though real sending waits for Bovann's choice of provider.

1. **Tables (migration `009`):** `t_sellers` (one per phone, created at the first successful sign-in, can be blocked), `t_seller_otps` (codes sent), `t_seller_sessions` (signed-in devices, hash of the cookie token).
2. **Codes.** 6 digits from a secure random source, valid 10 minutes, 5 tries, one use; only the phone's latest code works. A new code after 60 s, at most 5 per phone per hour, plus a limit per connection (`OTP_RATE_LIMIT_PER_HOUR`, 20) and 30 tries per minute per connection. That leaves an attacker about 25 guesses an hour out of a million. Requests for one phone are serialised with a MySQL named lock so two quick taps can't both pass the limits.
3. **Storage.** Only an HMAC-SHA256 of the code (key `OTP_SECRET`) is stored, compared in constant time. Wrong tries are committed before the error is returned.
4. **Sending** goes through a small `OtpSender` interface: `simulated` (development: the code is logged and returned as `devCode`, shown on the screen) or `disabled` (production default: sign-in answers "not open yet"). A WhatsApp/SMS provider is one new class. Production refuses to start with `simulated`.
5. **Sessions** like the admin's: random 256-bit token in an httpOnly, SameSite=Lax cookie, only its SHA-256 stored; 30 days without activity, 90 days at most; ended by sign-out or by blocking the seller. Changes need the `X-Bovann-Seller` header.
6. **Web.** `/vendeur/connexion`: one question per screen (number and WhatsApp/SMS, then the code), a single real code field over six boxes so SMS autofill and screen readers work, resend countdown, switch to the other channel. `/vendeur`: the seller's space. On the wall the header shows "Espace vendeur" instead of "Ma réservation".

## 20. Posting and reviewing lives (2026-11-11)

1. **Migration `010`:** `t_lives` gains `seller_id`, the review (`reviewed_by_admin_id`, `reviewed_at`, `reject_reason`) and the status `CANCELLED`. CHECKs: every live comes from a seller or from staff; a refusal has its reason and date. `t_review_hours` holds the weekly periods (weekday, opens, closes; no overlap is checked by the service, `closes > opens` by the database).
2. **Lifecycle:** `PENDING` → `APPROVED` (staff; on the wall from the approval time for the duration the seller chose) or `REJECTED` (with a message); `CANCELLED` by the seller before review; `ENDED` by the seller or `REMOVED` by staff while online. **Until passes and payment exist, approval puts the live on the wall at once.**
3. **Review hours** are computed by a pure function (`lives/review-hours.ts`, Lomé time zone) used by the wall, the seller screens and the submit check: open or not, when it closes, the next opening within a week, today's periods. Seed: Monday–Saturday 08:00–11:00 and 15:00–18:00 (the product owner's example), to be confirmed by Bovann.
4. **Submit rules, checked under a lock on the seller's row:** review open; one request waiting at a time; 5 lives a day (Lomé day, withdrawn ones not counted); the link not already waiting or online (row lock on the link, shared with staff actions).
5. **Staff alerts without notifications:** the admin menu shows the number of lives waiting (refreshed every 30 s), the review tab reloads every 20 s and shows when it was last updated. The seller's tracking screen asks every 10 s.
6. **Web:** `/en-direct/publier` (4 steps: link, country, category with "Autre", duration and name with a preview card; then the tracking screen; the closed screen with today's day bar), `/vendeur` lists the seller's lives with "J’ai terminé" / "Retirer", the wall has "Publier mon live" (sticky on phones, a card in the hero on computers, with the review status). Admin "Lives": tabs À valider / En ligne / Terminés / Heures de validation, refusal with ready-made messages.

## 21. Passes (2026-11-12)

Product-owner decision of 2026-11-12: **everyone who posts must have a pass** (subscription). Paying for a single live, and the "review first, then pay" flow, are switched off for now, to keep the product simple early on. Payment is simulated like slot bookings; only the real payment provider and WhatsApp/SMS remain.

1. **Migration `011`:**
   - `t_live_prices` (one row): monthly and annual pass. CHECK: the year costs less than 12 months. Seeded with the example prices (10 000 / 100 000 FCFA).
   - `t_seller_payments`: pass payment attempts (purpose, amount, method, operator, payer, status, provider reference, idempotency key).
   - `t_seller_passes`: plan, start, end, price, and either the payment or the staff member who activated it (CHECK: exactly one).
   - `t_lives` is unchanged.
2. **Sending** a live checks the pass inside the submit transaction (402 `PASS_REQUIRED`). **Approval** always puts the live online; the pass isn't checked again, so a pass ending during the few minutes of review doesn't lose the live.
3. **Payment** uses the same `PaymentGateway` contract as bookings (simulated provider until Phase 4). The attempt is written first, the provider is called outside the transaction. Confirmation (simulated: `/dev/seller-payments/:id/succeed`) is idempotent and adds the pass in the same transaction; a replaced or failed attempt confirmed later by the provider is still honoured (the money arrived).
4. **Passes chain:** a pass bought while another runs starts at its end (the seller row is locked so two confirmations still chain). Staff can activate one after a cash payment (audited).
5. **Web:** "Publier mon live" opens with the pass check: without one, "Prenez un pass pour publier" (annual or monthly, Mobile Money T-Money/Flooz or card, waiting screen, "Simuler un paiement réussi / un échec" when `NEXT_PUBLIC_PAYMENT_SIMULATION=true`), then the form. The last posting step and the seller space show the pass; `/vendeur/pass` extends it. Admin "Lives": "Vendeurs et pass" (activate a pass), "Prix" (administrators).
