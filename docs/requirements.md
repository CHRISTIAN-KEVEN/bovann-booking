# Bovann OCD Live — Requirements

_Last updated 2026-11-09_

## Context

- Booking system for a livestream studio / venue operated by **Bovann Group (registered in Togo)**
- In person = studio in Lomé, Togo; virtual = remote session
- Primary language: French
- Expected customers, in order of priority: Togo and neighbouring West African countries first, then the rest of Africa, then outside Africa progressively

## Session modes (confirmed)

- **En studio:** the customer comes onsite to the studio.
- **Virtuel:** the customer joins remotely. Bovann's team runs the live from the studio, with an onsite assistant moderating.
- Both modes use the same studio and team, so they share **one calendar per space**.
- The mode is shown to customers and owners so the team knows whether to expect the customer onsite or prepare a remote session.

## Customer flow

1. Choose mode: En studio (Lomé) or Virtuel
2. Choose month → see days with availability
3. Choose day → book single slots or a package
4. Customer details: full name, phone (required), business name and sector (required), email (optional)
5. Payment: Mobile Money (T-Money, Flooz) or card (Visa / Mastercard). Coverage for other countries: see payment-providers-analysis.md
6. Confirmation: reference, SMS/WhatsApp recap, receipt

## Notifications (confirmed)

- **When a booking is confirmed (payment succeeded), an email is sent to the space owners.** It contains the booking details (reference, date, time, package, mode, amount paid) and the customer's business details (name, phone, business name, sector, email if given, live description).
- Owner recipient addresses are configured per space by the admin (one or more).
- Customer confirmation: SMS/WhatsApp (provider TBD), plus email if the customer gave one.

### Email sending (decided 2026-11-09)

- **To start: Gmail.** Emails are sent through Gmail's own servers from the product owner's address (christiankeven326@gmail.com), with a Google App Password. Free, up to 500 emails a day, and delivered as genuine Gmail mail.
- **Later: a service with Bovann's own domain.** Brevo is free up to 300 emails a day; addresses such as reservations@bovann.tg need SPF and DKIM DNS records. Switching is a settings change only.
- **Not chosen:** sending as a @gmail.com address through a third-party service (Brevo, SendGrid…). Gmail's anti-spoofing rules (DMARC) send such mail to spam or reject it.
- **Emails sent:**
  - to owners: new confirmed booking (online or studio) with the customer's business details; payment received too late, refund to make
  - to customers, if they gave an email: booking confirmed; booking cancelled by the studio, with the refund amount (the studio's internal reason is never sent)

## Slots, packages & seed values

- Slot = **1h30** (seed and default)
- Base price of one slot = **15 000 XOF** (seed)
- Longer packages are offered at a reduced price compared with buying the same number of single slots. Admin-configurable; the system refuses a package whose price per slot isn't lower than shorter options.
- Seed packages (proposal, editable by admin): 1 slot 15 000 · 2 slots 27 000 (−10 %) · 4 slots 51 000 (−15 %) · full day 9 slots 108 000 (−20 %)
- Package start times are offered only where enough consecutive slots are free

## Holds (confirmed 2026-11-09: keep it simple)

- When the customer presses "Payer", their slots are held for **5 minutes** (configurable per space by the admin; default 5).
- The slots are freed immediately if the payment fails or the customer cancels, and automatically when the 5 minutes pass.
- **No penalties:** customers are never flagged or blocked for unpaid attempts and may retry as often as they like. A new attempt with the same phone number replaces their previous unpaid one.
- Basic protections kept: a request rate limit on "Payer" (5 per minute per connection) and an **optional** Cloudflare Turnstile bot check (off unless configured).
- _History: anti-abuse penalties approved on 2026-11-08 were removed on 2026-11-09 at the product owner's request (risk of blocking customers who share an operator IP, and unnecessary complexity)._

## Customers (confirmed 2026-11-08)

- One customer record per phone number. When a returning customer gives different details, the latest details are saved. Past bookings keep their own price and package details.

## Admin

- One space for now; admin can add more spaces (each with its own calendar, hours, modes, address, owner notification emails)
- Manage bookings, block slots, packages & prices, opening hours, exceptional closures

### Admin decisions (confirmed 2026-11-09)

- **Two roles.**
  - **Administrateur (OWNER):** everything.
  - **Équipe (STAFF):** sees bookings, clients and payments; adds studio bookings; records payments; blocks and unblocks slots.
  - **Administrator only:** cancellations and refunds, packages and prices, spaces, hours and closures, owner notification emails, user accounts.
- **Sign-in with email + password.**
  - Administrators create accounts for each other. The first account is created with a setup command (`admin:create`).
  - New accounts and password resets get a temporary password, which must be changed at the first sign-in.
  - A forgotten password is reset by another administrator. Reset by email comes after Phase 6.
- **Studio bookings.** The studio can book for a client who calls or comes in.
  - The booking is confirmed at once and uses the same calendar, so double booking is impossible.
  - Payment is noted as one of: paid (cash, mobile money received directly, card, bank transfer, other), unpaid (to collect later), or free (price 0).
  - A negotiated price is allowed, never above the price of the slots bought one by one.
  - No minimum notice or booking horizon applies. A slot in progress can still be booked for a walk-in.
- **Cancellation by the studio** (administrator) frees the slots at once.
  - If money was received, the booking is marked "refund to handle" for the amount paid (or a smaller amount, including 0). The studio refunds by hand, then marks it done.
  - Automatic refunds come with the real payment provider (Phase 4).
  - The customer is emailed if they gave an address (sent in Phase 6).
- **Late payment** for slots someone else has taken also lands in "refunds to handle".

## Customer cancellation (decided 2026-11-09)

- At least 48 hours before the live: the customer contacts the studio and chooses a full refund or a new date (subject to availability).
- Less than 48 hours before, or not showing up: no refund.
- A studio cancellation is always refunded in full, or moved to a new date if the customer prefers.
- Published on the conditions page (`/conditions`), linked from the booking form. To be reviewed by a lawyer before launch.

## Finding a booking again (decided 2026-11-09, changed 2026-11-10)

- No customer accounts or passwords.
- **"Retrouver ma réservation"** (`/mes-reservations`): the customer enters the booking reference and the phone number given when booking.
- **No list of bookings saved in the browser** (changed 2026-11-10): on a shared phone or computer, the next person would have seen the previous customer's bookings.
- **Receipt (2026-11-10):** after payment, the confirmation page offers "Télécharger le reçu (PDF)" with the reference, the session, the client, the amount and how to find the booking again. It is a "reçu de réservation", not an invoice.
- The customer confirmation email links to the search with the reference filled in.
- **Later**, with an SMS/WhatsApp provider: a code sent to the phone shows every booking for that number (a personal list without a password).

## Technical decisions (confirmed)

- Next.js + NestJS (TypeScript), **MySQL 8**, Docker Compose on a VPS
- **All database tables are prefixed with `t_`**
- Details: architecture.md

## Payments

- Merchant: Bovann Group (Togo). Bovann Group will request quotes and open the merchant account.
- Shortlist: Hub2, FedaPay, PayDunya (see payment-providers-analysis.md)

## Open assumptions (to confirm)

- Opening hours 08:00–21:30 → 9 slots/day
- Virtual price = in-studio price unless the admin sets otherwise
- SMS/WhatsApp and email sending providers: TBD

## Design

- Screens canvas (approved 2026-11-08): https://claude.ai/artifact/HYzmdfMYAoXsbNHWVDRycs
- **Phone and desktop (2026-11-09):** the customer site must work as well on a computer as on a phone, with the same simple flow, in the OCD Live brand (orange wordmark). The home page is our own design: reference images are inspiration, never to be copied. Details in progress.md.
