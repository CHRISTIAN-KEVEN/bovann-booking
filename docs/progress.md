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

## Search only, and the booking receipt (in review)

**Product owner, 2026-11-10.**

- **"Mes réservations" no longer lists the bookings saved in the browser.** On a shared phone or computer, the next person saw the previous customer's bookings. The page is now "Retrouver ma réservation": reference + phone only. The header and footer link reads "Ma réservation". A personal list comes later with a code sent to the phone.
- **Receipt:** "Télécharger le reçu (PDF)" on the confirmation page, generated by the API (`GET /bookings/:reference/receipt`), so customers keep their reference even without email.
- **Tests:** 2 API integration tests (PDF only once confirmed, file name, one page, token required) and 3 unit tests (payment line in the studio time zone, characters, one page for paid and unpaid, studio and virtual); web tests for the search page (never lists saved bookings) and the download helper. Totals: 248 (202 API, 5 shared, 44 web).
- **In Chrome at phone width:** booking paid, receipt downloaded and checked; the same browser then shows only the search form.

## One tap on a date opens its slots (in review)

**Product owner, 2026-11-10:** choosing a day, then pressing "Voir les créneaux", was one click too many.

- Tapping an open day now goes straight to its slots, like the mode choice on the home page. Full, closed and past days still can't be tapped.
- The "Voir les créneaux" button and the day summary under the calendar are gone; the slots screen already shows the date and what is free. A short hint under the calendar says what to do.
- Going back shows the chosen day highlighted. Opening the same day again keeps the slots already picked; another day clears them.
- On phones the step has no bottom bar any more; on a computer the "Votre réservation" panel stays.
- **Tests:** 3 web tests (one tap opens the slots, a full day does nothing, the earlier day is highlighted and keeps its slots). Checked in Chrome at 390 and 1440 px: no errors, no horizontal scrolling.

## French and English, step 1: the public site (in review)

**Product owner, 2026-11-10:** the whole product in French (main) and English. Part of the live directory work; this first step covers the customer site and everything it receives from the server.

### Delivered

- **English site at `/en`**, French unchanged at the plain address. FR | EN switch in the header on every page; it keeps the page you are on.
- **Every customer screen in English:** home, calendar, slots and packages, details form and its errors, payment, confirmation, "Find my booking", terms (a full English version that says the French text applies if they differ), calendar file.
- Dates, months, weekday initials and amounts in each language ("Thursday 12 November", "15,000 FCFA").
- **Server in the page's language:** error messages, validation messages, space and package names, simulated payment instructions.
- **Each booking remembers its language**: the customer's confirmation and cancellation emails are sent in it, with English links (`/en/…`). The studio's emails stay in French.
- **Receipt** in the language of the page it is downloaded from (`receipt-BOV-….pdf`).
- **Migration `007`:** English names for spaces and packages (filled by the seed: "Single slot", "3h package", "6h package", "Full day"), booking language, English package name kept with each booking.

### Tests

- **Totals:** 272 automated tests (210 API, 6 shared, 56 web).
- **API (8 new):**
  - names in English and French, French fallback when no English name exists
  - error and validation messages in English, messages built with values
  - a booking made in English: stored language, customer email in English, studio emails in French, English receipt
  - a check that every French API message has an English version
- **Web (7 new):**
  - addresses and the proxy (French address served from the plain path, `/fr/…` redirected)
  - the same keys in both languages, singular and plural
  - the language switch, the home page in English, dates in English, form errors in English, the calendar file in English
- **In a real Chrome at 390 px:** a full English booking from the home page to the confirmation, switching language with the header button, receipt downloaded in English, then the same booking shown in French. No browser errors, no horizontal scrolling.

### Not in this step

- Admin screens in English (next step).
- Business sectors: shown in English, still stored as the French label; they become the shared category list with "Autre" right after.
- The admin can't yet enter English names for packages and spaces (comes with the admin step); the seeded ones are in place.

## French and English, step 2: the admin (in review)

### Delivered

- **Every admin screen in English** at `/en/admin/…`:
  - sign-in and password change
  - bookings, calendar, booking panel, studio booking form, blocks
  - packages, spaces and hours, customers, payments, settings
- **Switching language:** FR | EN under the account name in the sidebar, and on the sign-in page. A sign-in requested from an English page returns to the English page.
- **English names:**
  - packages get a "Name in English" field, and spaces a "Name in English" field
  - empty means the French name is used
  - the packages table shows both names
- **From the API in the page's language:** booking history, email labels in the booking panel, package names in lists.
- **Amounts:** typed amounts accept "15 000" and "15,000". "15,5" is still refused, so a decimal can't be read as thousands.

### Tests

- **Totals:** 274 automated tests (211 API, 6 shared, 57 web).
- **API:** English names saved from the admin and shown to English customers; booking history, email labels and package names in English.
- **Web:** the booking panel in English (dates, amounts, cancel form); amount parsing both ways; the sign-in and panel tests now run inside the language provider.
- **In a real Chrome at 1440 px:**
  - a new administrator signs in at `/en/admin`, chooses a password, and visits every page in English
  - the package editor has the English name field
  - switching to French keeps the page
  - no browser errors

## Live directory, part 1: the wall (in review)

### Delivered

- **Page "En direct"** (`/en-direct`, English at `/en/en-direct`), from the approved design:
  - live count, country chips with flags and counts, TikTok / Facebook switch, categories (a sheet with big tiles on phones, a row on computers)
  - cards with the seller's initials, category colour, platform, time live, category and country; one tap opens the live on TikTok or Facebook in a new tab
  - empty, no-match, loading and error states; refreshes every minute; filters kept in the address
- **Header:** "En direct" and "Réserver le studio" tabs on the home page and the wall.
- **Admin "Lives"** (both roles): lives online, lives ended in the last 30 days, add a live for a seller, remove a live with a reason.
- **Categories table** with French and English names, used by lives (the booking form moves to it in the categories step).

### Decisions taken in this step (to confirm)

- **Staff can list a live for a seller**, approved at once. It lets Bovann fill the wall before sellers can sign in (that needs the SMS/WhatsApp provider), and stays useful for sellers who call or come to the studio.
- **Duration:** 1, 2, 3 or 4 hours (the proposal in requirements.md).
- **Countries:** the 16 countries of the phone picker.
- **No "Publier mon live" button yet:** it arrives with seller sign-in, so it never leads to a page that doesn't work.

### Tests

- **API (9 new):** wall content and order, expiry at `ends_at`, category names in both languages, typed categories, removal (once, audited), duplicate links, link and text rules with messages in both languages, staff session required, database CHECK rules.
- **Shared (6 new):** link checking (accepted forms, refused sites and schemes, look-alike hosts, length) and text cleaning.
- **Web (9 new):** filters in the address, country counts, time and initials; the wall's list, links (new tab, noopener), filters, "Autres", empty and error states, English.
- **Totals:** API 220, shared 12, web 66.
- **In a real Chrome:** staff added a live through the form and six more; the wall at 360, 390, 1000 and 1440 px, French and English, the category sheet and a filter; the admin list. No browser errors.

### Next

1. Seller accounts: phone + code by WhatsApp/SMS (simulated sender in development).
2. Posting a live, staff review queue (auto-refresh, counter), review hours.
3. Categories: the booking form uses the shared list, "Autre" everywhere, admin list of typed categories.
4. Passes and one-off payment.

## Live directory, part 2: seller sign-in (in review)

**Product owner, 2026-11-11:** build the code sign-in first; real sending waits for Bovann's provider.

### Delivered

- **Sign-in at `/vendeur/connexion`** (French and English), from the approved design: phone number with country, WhatsApp or SMS, then the 6-digit code (fills in from the SMS on phones), resend after a minute, switch to SMS or WhatsApp, "Changer" to fix the number.
- **Test mode:** with simulated sending (development) no message leaves; the code is shown on the screen with a "Remplir" button.
- **Closed until a provider exists:** in production, without a provider, the page says posting opens soon and points to the wall.
- **Seller space `/vendeur`:** the signed-in number and sign-out. Reached from "Espace vendeur" in the wall's header.
- **Security:** codes hashed with a server key, 5 tries, 10 minutes, one use; limits per phone and per connection; sessions in an httpOnly cookie; blocked sellers are signed out.
- **Settings:** `OTP_TRANSPORT` (`simulated` / `disabled`), `OTP_SECRET`, `OTP_RATE_LIMIT_PER_HOUR` (see `apps/api/.env.example`).

### Tests

- **API (10 new):** sign-in and seller created once, wrong tries counted then the code stopped, one use / 10 minutes / latest code only, one-minute wait and 5 per hour, phone and code checks, CSRF, sign-out, 30 days without activity, blocked seller, sign-in closed without a provider; production refuses simulated codes.
- **Web (7 new):** the two steps, number check and SMS, wrong code message, test-mode code, closed state, already signed in, safe return address.
- **Totals:** API 231, shared 12, web 73.
- **In a real Chrome:** sign-in from the wall at 390 px (French) and 1440 px (English), code typed in the boxes, seller space shown.

### Next

Posting a live (link, country, category, duration), the staff review queue and review hours.

## Live directory, part 3: posting and review (in review)

### Delivered

- **"Publier mon live"** on the wall (bottom of the screen on phones, a card on computers with "Validation ouverte · jusqu’à 18:00").
- **Posting, one question per screen** (`/en-direct/publier`, sign-in first): paste the link (platform and account read from it, "Où trouver le lien ?" in pictures), the country (one tap, the phone's country pre-selected), the category (one tap, "Autre" opens a field), the duration (1–4 h) and the name, with a preview of the card. Then "C’est envoyé !" with the progress, updated by itself; approved → "Votre live est en ligne !".
- **Outside review hours:** "L’équipe revient à 15:00", the wait, and today's hours on a bar.
- **Seller space:** "Publier un live", my lives with their state (en vérification, en ligne jusqu’à…, refusé with the team's message, terminé), "J’ai terminé" and "Retirer".
- **Admin "Lives":** "À valider" first (approve, or refuse with a ready-made message the seller sees), a counter in the menu, automatic refresh, a review-open chip; "Heures de validation" (administrators edit, the team sees).
- **Rules:** one request waiting per seller, 5 lives a day, a link can't be waiting or online twice, typed categories flagged to staff.

### Decisions taken in this step (to confirm)

- **Until payment exists, an approved live goes on the wall at once** (the agreed "review first, then pay" comes with passes and payment).
- **Default review hours:** Monday–Saturday 08:00–11:00 and 15:00–18:00; Sunday closed.
- **5 lives a day** per seller; one request waiting at a time.
- The seller sees the answer in the app (no WhatsApp message until there is a provider).

### Tests

- **API (14 new):** request → queue → approve → wall; refusal with message; closed hours and next opening (Sunday → Monday); one request at a time and withdrawal; daily limit; duplicate links; ending early and only one's own live; session and CSRF; review hours (roles, overlap, invalid times, empty week); review-hours rules as unit tests.
- **Web (5 new):** the four steps with "Autre", link refused, closed screen with the wait, following a waiting request, signed-out seller sent to sign-in.
- **Totals:** API 245, shared 12, web 78.
- **In a real Chrome:** a seller on a phone sees the closed screen, then posts (link, country, "Pagnes et tissus", 2 h); staff approve from the queue; the seller's screen turns to "en ligne" by itself; a second request is refused with a ready-made message, shown in the seller's space; the wall on a computer shows the live and the "Publier mon live" card. No browser errors.

### Next

1. Categories: the booking form on the shared list with "Autre", admin list of typed categories.
2. Passes and one-off payment.

## Live directory, part 4: passes (in review)

**Product owner, 2026-11-12:** posting must check that the seller has a valid subscription, with payment simulated like slot bookings; only the payment provider and WhatsApp/SMS remain. After discussing how to keep jokers out (free sending invites them; paying per live before review needs refunds or credits), the decision is: **everyone who posts must have a pass**, and the single-live payment is switched off for now.

### Delivered

- **No pass, no posting:** "Publier mon live" first checks the pass. Without one: "Prenez un pass pour publier", annual (marked "Le moins cher") or monthly, Mobile Money (T-Money, Flooz, the seller's number pre-filled) or card, a waiting screen and, in demo mode, "Simuler un paiement réussi / un échec". Success opens the form; a failure lets the seller try again.
- The API refuses a live sent without a pass (402 `PASS_REQUIRED`), so the rule holds whatever the screens do.
- **Approval** puts the live online at once.
- **Passes:** shown on the last posting step and in the seller space ("Pass mensuel · jusqu’au …", "Prolonger mon pass"); a new pass follows the current one.
- **Admin "Lives":** "Vendeurs et pass" with "Activer un pass" for cash payments; "Prix" (administrators) with the rule "a year costs less than 12 months".

### Decisions taken in this step (to confirm)

- Example prices until Bovann sets its own: 10 000 FCFA a month, 100 000 FCFA a year.
- Staff (both roles) can activate a pass after a cash payment; only administrators change prices.
- A live sent while the pass was valid still goes online if the pass ends during review.

### Tests

- **API (10 new):** sending refused without a pass; monthly pass by Mobile Money then send, approve, online; failure then retry and replaced attempt; pass ending during review; passes bought ahead chain; a pass running out; staff activation; prices (roles, rule, amounts used); request checks; database rules. The posting tests give their sellers a pass.
- **Web:** the pass screen when the seller has none (no single-live option), paying then the form; back to the pass when it ran out while filling in the form; the pass on the last step.
- **Totals:** API 254, shared 12, web 81.
- **In a real Chrome at phone size:** a new seller signs in from "Publier mon live", gets the pass screen, a first payment fails, the second succeeds, the form opens, the live is sent, staff approve it, it goes online; the seller space shows the pass; staff open "Vendeurs et pass" and "Prix". No browser errors.

## Staging deployment and reviewer agent (in review)

**Product owner, 2026-11-24:** a staging site the client can open at any time without Keven's laptop (replacing the Cloudflare tunnel), and an independent reviewer agent.

### Delivered

- **Staging stack** (`infra/staging/`): Docker images for the API and the website, Compose with Caddy (HTTPS, one site password, hidden from search engines), MySQL, Mailpit for the emails, nightly backups.
- **Automatic deploys:** after CI passes on `main`, GitHub Actions builds the images, deploys them over SSH, runs the migrations and checks the site from outside. Roll back by re-running the workflow with an earlier commit.
- **`DEPLOY_ENV=staging`:** production builds that still allow simulated payments and codes, so the client can try everything. Without it, production refuses them as before.
- **Server setup script and runbook** (`docs/deployment.md`): firewall, automatic security updates, a `deploy` user, random secrets.
- **Reviewer agent** (`.claude/agents/reviewer.md`) and the rule to run it before every report (CLAUDE.md).

### Tests

- **Totals:** API 259, shared 12, web 81.
- **API (4 new unit tests):** staging allows simulations; production with or without `DEPLOY_ENV=production` refuses them; staging still needs emails and HTTPS; unknown deployment names refused.
- **CI job "Staging stack":** on every PR, builds both images, deploys them on the runner, books and pays a slot by simulation, checks the receipt, the double-booking refusal, the owners' email, the password and `noindex`, then deploys again and checks the data stays and the seed does not re-run.
- Scripts checked with shellcheck, workflows with actionlint.
- The production bundle of the API (what goes in the image) was run locally: it refuses simulated payments as a plain production build, and with `DEPLOY_ENV=staging` it migrates, seeds, starts and accepts simulated payments.
- Not testable in the development workspace (Docker Hub is blocked there): the image builds run in CI only.

### Found and fixed on the way: two "time bombs" in the tests

All 83 admin and seller sign-in tests started failing once the real date passed the tests' frozen clock (9–16 November), on `main` too:

- **Admin sessions** took `created_at` from the database clock and `expires_at` from the app clock; the database rule `expires_at > created_at` failed when the two clocks disagreed (frozen test clock; in production, a database clock behind the app). Both now come from the app clock, as for sellers.
- **Session cookies** carried a fixed expiry date computed from the app clock, so the test client dropped them as already expired. They now carry a lifetime (`Max-Age`): 7 days for staff, 90 for sellers, counted by the browser. This also keeps visitors signed in when their device's clock is wrong.
- Two tests now check both (`Max-Age` on the cookies, `created_at` on the app clock).

### Found by the new CI deployment test (first run)

- **An empty setting blocked the deploy:** `STUDIO_CONTACT_PHONE=` (empty) was refused as "too short" and the migrations never ran. Empty values now mean "not set" (test added).
- **The CI step showed green while the deploy had failed:** `deploy.sh | tee log` hid the exit code (GitHub's default shell has no `pipefail`). The job now runs with `pipefail`, and the "already seeded?" check stops with a clear error if it can't read the database, instead of silently skipping the seed.
- **The open health check asked for the password:** Caddy applies `basic_auth` before any `handle` block in the same scope, wherever it is written, so the deploy waited for `/healthz` in vain. The password now sits inside the block that covers everything except `/healthz`. Checked by running Caddy locally against stand-in services: `/healthz` open, pages and API refused without or with a wrong password, `noindex` and HTTPS headers present.

### Independent review (reviewer agent): "Ready after small fixes"

It found what neither the tests nor CI could see, because it only happens on the server or under misuse. All fixed:

- **A failed backup was logged as "ok"** (`mysqldump | gzip` takes gzip's exit status), and a truncated dump would push out a good one. Now `backup.sh` keeps a dump only if it is complete, and CI makes one and checks it.
- **The restore command in the runbook could not work** (the dumps are in a Docker volume, not on the host). Corrected, with "make a backup now".
- **The rollback version was not checked:** typed by hand, it went into a command on the server. Only a full commit SHA is accepted now, in the workflow and in `deploy.sh`.
- **Old images would fill the server's disk** over a few dozen deploys. The server now keeps only the current and previous ones.
- Smaller points also fixed: the job talking to the server can no longer push images; the staging website image has its own name; `DEPLOY_ENV=staging` lifts only the two simulation rules; a backup night could be skipped; SSH password login is turned off when a key exists; the runbook creates the GitHub environment first and says the `deploy` user is root-equivalent.

### Waiting for

- Keven: the server, the domain, and the GitHub secrets (steps in `docs/deployment.md`).

## Then: Phase 4 — Payments

Real provider adapter (Hub2 / FedaPay / PayDunya, depending on Bovann Group's choice), signed webhooks, reconciliation job, card redirect flow, for bookings and for sellers' passes. Needs: the provider's sandbox credentials.

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
