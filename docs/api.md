# API reference

Base URL: `/api/v1` (health checks at the root). JSON only. Customer endpoints are public; admin endpoints arrive in Phase 5, real payment webhooks in Phase 4.

## Conventions

- **Instants** (`start`, `end`) are ISO 8601 in UTC, for example `2026-11-12T08:00:00.000Z`.
- **Local dates and times** (`date`, `startTime`, `today`) are in the space's time zone (Lomé), ready to display: `2026-11-12`, `08:00`.
- **Amounts** are whole XOF (FCFA).
- **Modes:** `IN_PERSON` (en studio) or `VIRTUAL` (virtuel).
- Response types live in `packages/shared/src/api.ts`, shared with the web app.

### Errors

Every error has the same shape. `code` is stable, for program logic; `message` is French and can be shown to users as is.

```json
{ "statusCode": 404, "code": "SPACE_NOT_FOUND", "message": "Cet espace est introuvable." }
```

| Code                                                                       | HTTP      | When                                                          |
| -------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| `VALIDATION_ERROR`                                                         | 400       | Missing or malformed parameter (`details` lists each problem) |
| `MODE_NOT_AVAILABLE`                                                       | 400       | The space doesn't offer this mode                             |
| `SPACE_NOT_FOUND`                                                          | 404       | Unknown or inactive space                                     |
| `NOT_FOUND`                                                                | 404       | Unknown route                                                 |
| `PRICING_UNAVAILABLE`                                                      | 503       | The space has no single-slot price configured                 |
| `SLOT_NOT_FOUND`, `EMPTY_SELECTION`, `TOO_MANY_SLOTS`, `PACKAGE_NOT_FOUND` | 400       | Invalid selection                                             |
| `SLOT_UNAVAILABLE`, `PACKAGE_DOES_NOT_FIT`                                 | 409       | Someone took the slot(s) first: show the day again            |
| `TOO_MANY_REQUESTS`                                                        | 429       | Request rate limit                                            |
| `CAPTCHA_FAILED` / `CAPTCHA_UNAVAILABLE`                                   | 400 / 503 | Bot check refused or unreachable                              |
| `BOOKING_NOT_FOUND`                                                        | 404       | Unknown reference or wrong access token                       |
| `BOOKING_NOT_CANCELLABLE`                                                  | 409       | Already confirmed                                             |
| `PAYMENT_PROVIDER_UNAVAILABLE`                                             | 502       | The provider couldn't start the payment; slots were freed     |
| `INTERNAL_ERROR`                                                           | 500       | Unexpected error (logged server-side, details never exposed)  |

## Health

| Endpoint            | Response                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| `GET /health/live`  | `200 {"status":"ok"}` while the process runs                                     |
| `GET /health/ready` | `200` when the database is reachable, `503` with `"status":"degraded"` otherwise |

## Spaces & availability

### `GET /spaces/:slug`

Space details for the first screen.

```json
{
  "slug": "studio-principal-lome",
  "name": "Studio principal — Lomé",
  "address": null,
  "timezone": "Africa/Lome",
  "slotDurationMin": 90,
  "modes": ["IN_PERSON", "VIRTUAL"],
  "booking": {
    "minLeadMin": 60,
    "horizonDays": 90,
    "today": "2026-11-08",
    "lastBookableDate": "2027-02-06"
  }
}
```

### `GET /spaces/:slug/packages?mode=IN_PERSON`

Catalog of packages and prices for a mode (not tied to a date). For the full-day package, `slotCount` is the longest opening day of the week.

```json
{
  "mode": "IN_PERSON",
  "unitPriceXof": 15000,
  "packages": [
    {
      "code": "PACK_6H",
      "name": "Pack 6h",
      "description": null,
      "isFullDay": false,
      "slotCount": 4,
      "durationMin": 360,
      "price": {
        "listPriceXof": 60000,
        "discountXof": 9000,
        "totalXof": 51000,
        "discountPercent": 15
      }
    }
  ]
}
```

### `GET /spaces/:slug/availability?month=2026-11`

One entry per day of the month, for the calendar.

```json
{
  "month": "2026-11",
  "days": [{ "date": "2026-11-12", "status": "AVAILABLE", "availableCount": 6 }]
}
```

Day `status`:

| Status         | Meaning (calendar display)                                |
| -------------- | --------------------------------------------------------- |
| `AVAILABLE`    | More than 3 slots left (threshold configurable per space) |
| `FEW`          | 1 to 3 slots left: "presque complet"                      |
| `FULL`         | No slot left: "complet"                                   |
| `CLOSED`       | Closed weekday or exceptional closure                     |
| `PAST`         | Earlier date, or today with no slot still bookable        |
| `OUT_OF_RANGE` | Beyond the booking horizon (90 days)                      |

### `GET /spaces/:slug/availability/:date?mode=IN_PERSON`

Everything the day screen needs: each slot, and where each package fits.

```json
{
  "date": "2026-11-12",
  "mode": "IN_PERSON",
  "status": "AVAILABLE",
  "availableCount": 6,
  "unitPriceXof": 15000,
  "slots": [
    {
      "start": "2026-11-12T08:00:00.000Z",
      "end": "2026-11-12T09:30:00.000Z",
      "startTime": "08:00",
      "endTime": "09:30",
      "status": "AVAILABLE"
    },
    {
      "start": "2026-11-12T09:30:00.000Z",
      "end": "2026-11-12T11:00:00.000Z",
      "startTime": "09:30",
      "endTime": "11:00",
      "status": "BOOKED"
    }
  ],
  "packages": [
    {
      "code": "PACK_6H",
      "slotCount": 4,
      "price": { "totalXof": 51000, "discountPercent": 15 },
      "startOptions": [
        {
          "start": "2026-11-12T12:30:00.000Z",
          "end": "2026-11-12T18:30:00.000Z",
          "startTime": "12:30",
          "endTime": "18:30"
        }
      ]
    }
  ]
}
```

Slot `status`: `AVAILABLE`, `BOOKED` (booked or blocked by an admin; customers aren't told which), `CLOSED`, `PAST` (starts in less than the lead time), `OUT_OF_RANGE`.

An empty `startOptions` means the package can't be booked that day. The full-day package fits only when every slot of the day is available.

## Availability rules (implemented in `apps/api/src/availability/domain`)

1. Slots run back to back from opening time; a slot that would end after closing isn't offered (08:00–21:30 → 9 slots).
2. A slot overlapping an exceptional closure is `CLOSED`.
3. A slot starting less than `min_lead_min` (60) minutes from now is `PAST`.
4. Days after today + `horizon_days` (90) are `OUT_OF_RANGE`.
5. A slot is `BOOKED` if held by an admin block, a confirmed booking, or a pending booking whose payment hold hasn't expired. **Expired holds count as free.**
6. A package of N slots fits at a start time when N consecutive slots are all available.
7. Package price: discount = (unit price × N) − package price, never negative.
8. Price ladder (checked when an admin saves prices, Phase 5): every multi-slot package costs less than its slots bought one by one, and longer packages cost strictly less per slot.

## Bookings (Phase 3a)

### `POST /bookings`: the "Payer" step

Holds the slots for **5 minutes** (per-space setting, 2–15) and starts the payment, in one call.

```json
{
  "spaceSlug": "studio-principal-lome",
  "mode": "IN_PERSON",
  "selection": { "type": "PACKAGE", "packageCode": "PACK_6H", "start": "2026-11-12T12:30:00.000Z" },
  "customer": {
    "fullName": "Afi Mensah",
    "phone": "+22890123456",
    "email": null,
    "businessName": "Boutique Afi Mode",
    "businessSector": "Mode & beauté"
  },
  "liveDescription": "Nouvelle collection",
  "acceptTerms": true,
  "payment": { "method": "MOBILE_MONEY", "channel": "TMONEY", "payerPhone": "+22890123456" },
  "captchaToken": "…"
}
```

Single slots instead of a package: `"selection": { "type": "SLOTS", "slotStarts": ["…", "…"] }`, at most 20 slots, all on the same day.

**`201`**

```json
{
  "booking": {
    "reference": "BOV-2611-7KQ4M",
    "status": "PENDING_PAYMENT",
    "holdExpiresAt": "2026-11-08T21:05:00.000Z",
    "…": "…"
  },
  "accessToken": "…",
  "payment": { "status": "PENDING", "instructions": "…", "redirectUrl": null }
}
```

`accessToken` is shown **once**. The browser keeps it and sends it as the `X-Booking-Token` header to follow or cancel the booking. The server stores only its hash.

What happens, in one database transaction:

1. The customer is saved: one record per phone number, latest details win, and a previous email is kept if none is given.
2. The same phone's previous unpaid hold is replaced and its slots freed.
3. Expired holds sitting on the requested slots are reclaimed.
4. The booking is created and its slots locked by the unique index. If a slot was taken meanwhile, the answer is `409 SLOT_UNAVAILABLE`.
5. A payment attempt is recorded.

The payment is then started with the provider, outside the transaction.

### `GET /bookings/:reference` (header `X-Booking-Token`)

The booking as the customer sees it (`BookingDto`): status, slots, local times, price, `holdExpiresAt` and `holdSecondsLeft` while unpaid (count down from `holdSecondsLeft`: it is computed by the server, so customer device clocks don't matter), payment status. Polled by the payment screen, used by the confirmation screen.

### `POST /bookings/:reference/cancel` (header `X-Booking-Token`)

The customer gives up before paying: slots are freed **immediately**. Idempotent. A confirmed booking answers `409 BOOKING_NOT_CANCELLABLE`.

### Development only: `POST /dev/payments/:reference/succeed` | `/fail`

Decides the outcome of a simulated payment. Answers 404 unless `PAYMENT_PROVIDER=mock` outside production. Replaced by signed provider webhooks in Phase 4.

## Booking lifecycle

| Event                                          | Result                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Payment succeeds                               | `CONFIRMED`; owner emails (and the customer's, if an email was given) queued **in the same transaction** |
| Customer cancels                               | `CANCELLED` (`CUSTOMER_CANCELLED`), slots freed at once                                                  |
| Payment fails                                  | `CANCELLED` (`PAYMENT_FAILED`), slots freed at once                                                      |
| Same phone holds again                         | previous hold `CANCELLED` (`SUPERSEDED`)                                                                 |
| 5 minutes pass unpaid                          | slots count as free immediately; the cleanup job (every 30 s) marks it `EXPIRED`                         |
| Payment arrives after expiry, slots still free | slots taken back, `CONFIRMED`                                                                            |
| Payment arrives after expiry, slots taken      | stays `EXPIRED`, refund flagged to the owners (`owner_late_payment_refund` email)                        |
| Provider can't start the payment               | `CANCELLED` (`PAYMENT_INIT_FAILED`), slots freed                                                         |

## Protections (decision of 2026-11-09)

No penalties: customers may retry freely. Kept:

| Protection                      | Default                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Hold duration                   | 5 min (per space, configurable)                                                   |
| Unpaid holds per phone          | 1 at a time: a new attempt replaces the previous one                              |
| "Payer" requests per connection | 5 per minute (`HOLD_RATE_LIMIT_PER_MIN`)                                          |
| Bot check                       | Cloudflare Turnstile, **optional** (active only if `TURNSTILE_SECRET_KEY` is set) |
