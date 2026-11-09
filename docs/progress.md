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

## Phase 5a — Admin API (in review)

**Objective:** everything the studio needs to run its calendar, behind a sign-in. Screens come in 5b.

**Decisions applied (product owner, 2026-11-09):**

- Two roles: Administrateur / Équipe.
- Email and password sign-in.
- Studio bookings with the payment noted.
- Cancellation marks the refund "to handle".

### Delivered

- **Sign-in and accounts**
  - Argon2id passwords.
  - Database sessions in an httpOnly cookie: 12 h without activity, 7 days at most.
  - Account lockout after 5 wrong passwords (15 min), and a per-connection sign-in limit.
  - CSRF header on every change.
  - Temporary passwords that must be changed.
  - Accounts can be created, deactivated (signed out at once), have their role changed or their password reset; there is always one active administrator.
  - Setup command: `pnpm --filter @bovann/api admin:create --email … --name "…"`.
- **Bookings**
  - List with tabs (all, confirmed, waiting for payment, cancelled, to collect, refunds to handle, abandoned checkouts), search by name, business, phone or reference, date filter and pages.
  - Detail with slots, payments and full history.
  - Studio bookings: confirmed at once, same slot locks as online, paid, unpaid or free, negotiated price allowed. No minimum notice, and the slot in progress is bookable.
  - Record a payment later. Internal note.
  - Cancellation by an administrator with "refund to handle", then mark it refunded.
  - Late online payments for slots already taken also land in "refunds to handle".
- **Planning:** day and week schedule (booked / waiting / blocked / closed / free), slot blocks with reason, dashboard figures (today, week occupancy, collected this month net of refunds, to collect, refunds due).
- **Settings**
  - Spaces: create, edit, modes, notice, horizon, hold 2–15 min.
  - Opening hours and closures, refused with the list of affected bookings when they would exclude one.
  - Owner notification emails.
- **Packages and prices:** create, edit, withdraw from a mode, deactivate; versioned prices; the price ladder is enforced.
- **Clients and payments** lists.
- **Migration `005`:** sessions, lockout, booking source, refund tracking, studio payment methods; integrity rules as CHECK constraints.
- **Refactor:** the online booking engine and studio bookings now share the same write steps (`booking-writes.ts`).

### Tests (166 API, all passing; 190 in the repo)

- **46 new admin integration tests against MySQL**, including:
  - sign-in, lockout and its expiry, rate limit, CSRF, idle and absolute session expiry, roles, deactivation, temporary passwords, password change signing out other devices, last administrator
  - studio bookings (package, negotiated, free, inside the hour, no double booking either way, expired hold reclaimed), customer lookup, day options
  - payment recording, cancel and refund flow with history, stopping an online payment in progress
  - list search and tabs, schedule states, blocks, dashboard figures
  - hours and closure conflicts, new slot grid, hold duration bounds, new space, notification emails
  - price ladder, price versioning seen by customers, new package in one mode
  - clients and payments pages
- **4 new database integrity tests:** studio booking without its author, refund without amount or date, "Remboursée" without a done refund, unique session token. One of them caught a CHECK that let a missing refund amount through; it was fixed before review.
- **4 password unit tests.**

## Phase 5b — Admin screens (in review)

**Objective:** the studio runs its calendar from the browser, following the approved designs (Réservations, Forfaits & prix, Espaces & horaires).

### Delivered (French, `/admin`, desktop first and usable on a phone)

- **Sign-in**, forced choice of a personal password after a temporary one, sign-out. Returns to the page that asked for sign-in. The admin area is excluded from search engines.
- **Réservations:**
  - the 4 figures from the design, plus a "refunds to handle" banner
  - day planning (booked / waiting for payment / blocked / free); click a booking to open it, a free slot to book or block it, a blocked slot to unblock it
  - list with tabs (all, confirmed, payment in progress, to collect, to refund, cancelled, abandoned), search, period filter and pages
- **Booking panel:** session, client (tap-to-call), payments, history, internal note.
  - Actions follow the role: record a payment (everyone); cancel with the amount to refund, and mark refunded (administrator).
- **Studio booking form:**
  - date, mode, single slots or a package with its start time
  - client found by phone number (details pre-filled)
  - catalog price, or a negotiated price / free
  - paid now (method, operator) or to collect later
  - if the slot was taken meanwhile, a clear message and refreshed availability
- **Block slots** with a reason (suggested reasons).
- **Calendrier:** week view of every slot, same actions as the day planning.
- **Forfaits & prix** (design): base price per mode, package table with discount badges, editor with the live "client saves X (−Y %)" calculation and the ladder rule. Server refusals are shown as they come.
- **Espaces & horaires** (design):
  - space cards and a new space
  - settings: modes, notice, horizon, hold 2–15 min, "presque complet"
  - weekly hours with slot counts
  - closures (whole days or hours)
  - conflicts list the bookings in the way
- **Clients:** search, totals, client panel with their bookings.
- **Paiements:** refunds to handle, then all payments filtered by state.
- **Paramètres:**
  - my account and password
  - users: create (temporary password shown once, with copy), change role, reset password, deactivate or reactivate
  - owner notification emails: add, pause, remove
- The team (Équipe) sees no administrator-only action; the API refuses them anyway.

### Tests

- **Totals:** 202 automated tests (166 API, 5 shared, 31 web)
- **New web tests (12):** admin API client (cookie, CSRF header only on changes, ended session sends the admin to sign-in except on a failed sign-in, clean queries), display helpers (phone, statuses, payment labels, French amounts, studio-local dates), sign-in page (validation, server message, return to the requested page or to the password change), booking panel (cancel a paid booking: reason required, amount paid proposed, request sent, refund action shown)
- **End-to-end in a real Chrome against the running API** (one-off):
  - sign-in (wrong then right password), studio booking, cancellation with refund to handle, every page at desktop and phone width
  - administrator creates a team member, who signs in with the temporary password, must choose a new one, and then sees no administrator-only actions
  - no browser errors besides the expected 401 before sign-in, and no horizontal scrolling

### Found and fixed during the visual check

- Time fields showed "08:00 AM" in browsers set to English: replaced by 24-hour pickers.
- Figures stacked one per line on phones: two per line now.
- French punctuation spacing in the admin texts.

## Phase 6 — Emails (in review)

**Objective:** owners hear about every booking by email, with the customer's business details; customers get their confirmation.

**Decision (product owner, 2026-11-09):** free sending, starting with his Gmail address. Applied as Gmail's own servers with an App Password (free, 500/day, passes Gmail's checks); later Brevo (free, 300/day) with Bovann's domain. Only settings change.

### Delivered

- **Outbox worker**
  - Sends the queued emails every 15 s.
  - Retries with growing delays for about 8 hours, gives up at once on an address refused for good.
  - Picks up emails interrupted by a crash; safe with several API instances.
- **Four French emails** (HTML + plain text, readable on phones):
  - **New booking, to owners:** session, customer's business details with tap-to-call phone, the live, amount, whether it was paid online or added by the studio, a reminder for virtual sessions, and a link to the admin.
  - **Confirmation, to customers:** date, times (separate slots listed), package, mode, studio address in studio, amount, reference, contact phone.
  - **Cancellation by the studio, to customers:** with the refund to come; the internal reason is never sent.
  - **Payment received too late, to owners:** amount to give back and a link to Paiements.
- **Admin**
  - Each booking shows its emails and whether they left, with "Renvoyer" for a failed one.
  - Paramètres shows the sender and the queue, and sends a test email that displays the provider's answer.
- **Configuration**
  - `EMAIL_TRANSPORT`, `SMTP_*`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `PUBLIC_WEB_URL`, `STUDIO_CONTACT_PHONE`, `NOTIFICATION_INTERVAL_SEC`, validated at startup.
  - Production refuses to start without email sending.
  - Development uses Mailpit (http://localhost:8025).

### Tests

- **Totals:** 228 automated tests (192 API, 5 shared, 31 web)
- **12 new integration tests against MySQL:**
  - owners and customer emailed once after payment; no customer email without an address
  - temporary failure retried on schedule, then failed, then sent again from "Renvoyer"
  - address refused for good; daily quota retried; email interrupted by a crash picked up
  - studio cancellation email with the refund amount and without the internal reason
  - studio booking emailed to owners, visible in the booking
  - late payment refund email
  - settings, test email (role, provider refusal shown), sending not configured
- **14 new unit tests:** each template, escaping, separate slots, older queued emails, sending error classification, settings validation.
- **End-to-end over real SMTP (Mailpit):** an online booking paid → 3 emails delivered within 15 s, including to christiankeven326@gmail.com as an owner address. Emails queued earlier in development were delivered too, and the test email from Paramètres arrived. The emails were checked on desktop and phone widths.

### Found and fixed later (2026-11-09)

- Queued emails took their "due" time from the database clock while the sender used the app clock. Tests with a frozen clock started failing once real time passed it; in production a clock difference between the two could have delayed emails. Emails are now queued with the app clock.

## Customer site redesign: phone and desktop (in review)

**Objective:** the customer site was a phone-width column, even on a computer. It now works on both, in the OCD Live brand, with the same simple flow (requested by the product owner on 2026-11-09, with the studio sign, a landing mock-up and a mobile booking reference).

### Delivered

- **Brand:** OCD Live wordmark (drawn after the studio sign, to replace with the official vector file), "par Bovann", Poppins for headings, brand orange `#f26b1d` for highlights. Buttons keep the darker orange so white text stays readable (WCAG AA).
- **Home page:** headline, the two modes, and the prices taken from the catalog. _Redone on 2026-11-09 (see below): the first version followed the reference mock-up too closely._
- **One tap less:** choosing a mode now opens the calendar directly (no separate "Continuer").
- **Desktop (≥ 1024 px):**
  - booking steps use the width: content on the left, a sticky "Votre réservation" panel on the right with the earlier choices, "Modifier" links, the total and the main button
  - bigger calendar days, slots in two columns, so a whole day fits on one screen
  - the confirmation is one centred column
- **Phones:** the booking steps are unchanged apart from the new header.
- **Tablets:** one centred column (680 px).

### Tests

- 5 new web tests: one-tap mode choice saved in the flow, price line (lowest price across modes), only the modes the studio offers, recap panel content per step and without edit links once payment started. Totals: 233 (192 API, 5 shared, 36 web).
- Full booking in a real Chrome at 390, 820 and 1440 px wide: no browser errors, no horizontal scrolling.

### Open choices for the product owner

- Official logo file (SVG or high-resolution PNG) to replace the drawn wordmark.
- Labels "En studio / Virtuel" are kept (used in emails and the admin); "Au studio / À distance" may read more clearly to customers.
- The site speaks with "vous"; the landing mock-up uses "tu".
- Not added, to keep things simple: dark/light switch, launch countdown, currency switch.

## Customer site: conditions, loaders, Mes réservations (in review)

**Requested by the product owner on 2026-11-09.** Decisions: no accounts ("Mes réservations" instead); cancellation rule of 48 h.

### Delivered

- **Conditions de réservation et d’annulation** (`/conditions`):
  - service, booking, payment, cancellation by the customer (48 h rule), cancellation by the studio, personal data, contact
  - linked from the details checkbox (opens in a new tab, the form is kept) and from a footer on every page
  - the studio phone comes from `NEXT_PUBLIC_STUDIO_CONTACT_PHONE`
- **Loaders:**
  - calendar-shaped skeleton while a month loads
  - slot skeletons in the same layout as the slots
  - booking-card skeleton on the confirmation page and in Mes réservations
  - placeholder for the price line on the home page
  - spinners on "Payer", "Annuler" and the demo payment buttons, which are also disabled while they work
- **Mes réservations** (`/mes-reservations`, link in the header and footer):
  - bookings made on this device, upcoming first, then past or cancelled
  - find a booking with its reference and phone number; it is then remembered on this device
  - a confirmation link opened on another device offers "Retrouver ma réservation" with the reference filled in
  - the customer confirmation email has a "Voir ma réservation" button and states the 48 h rule
- **API:** `POST /bookings/lookup`, migration `006` (`t_booking_access_tokens`), `LOOKUP_RATE_LIMIT_PER_MIN` (10).

### Tests

- **API:** 5 new integration tests:
  - lookup works, with lower-case reference and spaced phone
  - a new token per device, and the first device keeps access
  - same 404 for a wrong phone and an unknown reference
  - validation
  - a token does not open another booking
  - the rate limit is separate from "Payer"
- **Email template:** the confirmation links to Mes réservations and states the 48 h rule.
- **Web:** 4 new tests:
  - device list order, and dead tokens forgotten
  - empty state
  - lookup success, remembered on the device
  - field checks and server error
- **Totals:** 242 automated tests (197 API, 5 shared, 40 web).
- **In a real Chrome at 390 and 1440 px:**
  - loaders captured with a slowed API
  - booking on one browser, listed in Mes réservations
  - confirmation link opened in a fresh browser, wrong number refused, right number opens the booking
  - no browser errors, no horizontal scrolling

### To do before launch

- Lawyer review of the conditions; set the studio phone.
- Record which version of the conditions each booking accepted (a `terms_version` column), if the lawyer recommends it.

## Original home page (in review)

**Product owner, 2026-11-09:** the home page copied the reference mock-up (dark stage, glowing Africa map with dotted links, the same headline and cards). It was to be inspiration only. Redone as our own design, same flow:

- Light, warm page under the dark brand header.
- Headline "Passez en direct. On s’occupe du plateau." and our own text.
- Visual: a phone showing a live sale in progress ("EN DIRECT", viewers, comments, "Commander") in front of a studio ring light, with the booked slot card. Drawn in CSS, decorative, hidden from screen readers.
- Mode choice as two rows, each with its own starting price from the catalog (skeleton while it loads). One tap still opens the calendar.
- "Comment ça marche" in three steps: choose a slot, pay online, go live.
- The Africa map and its data file are removed.
- Tests updated (price per mode). Checked in Chrome at 390, 820 and 1440 px: no errors, no horizontal scrolling.

## Then: Phase 4 — Payments

Real provider adapter (Hub2 / FedaPay / PayDunya, depending on Bovann Group's choice), signed webhooks, reconciliation job, card redirect flow. Needs: the provider's sandbox credentials.

## Known issues / technical debt

- TypeScript table types are maintained by hand (see architecture.md §1). Consider generating them with `kysely-codegen` in CI if drift becomes a problem.
- `ts-jest` 29 runs with Jest 30. Works today; move to ts-jest 30 when it is released.
- Booking slot end times are derived from the space's current slot duration when displayed. The admin does not allow changing the slot duration (Phase 5); if it is ever needed, it must be refused while future bookings exist.
- The end-to-end browser tests (customer flow and admin) were run manually (Puppeteer + Chrome). Automate them with Playwright in CI during Phase 7 (hardening).
- The customer site shows one space (`NEXT_PUBLIC_SPACE_SLUG`). The admin can create more spaces, but customers can only book a second space once the site offers a space choice (small change, to schedule when a second studio opens).
- The seed dates prices from the moment it runs (`valid_from = now`). Fine in practice; tests backdate them because they freeze the clock earlier.
- Admin sign-in limits per connection are kept in memory: fine for one API instance; move them to the database or Redis if the API ever runs on several machines.
- Customers cancel by contacting the studio (48 h rule); there is no self-service cancellation after payment. Possible later, inside Mes réservations.
- A studio cancellation of an online payment in progress only marks it cancelled on our side; with a real provider (Phase 4) the payment must also be cancelled or refunded at the provider.
