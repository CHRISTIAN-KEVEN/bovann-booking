# API reference

Base URL: `/api/v1` (health checks at the root). JSON only. All business endpoints are public and read-only so far; booking, payment and admin endpoints arrive in Phases 3–5.

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

| Code                  | HTTP | When                                                          |
| --------------------- | ---- | ------------------------------------------------------------- |
| `VALIDATION_ERROR`    | 400  | Missing or malformed parameter (`details` lists each problem) |
| `MODE_NOT_AVAILABLE`  | 400  | The space doesn't offer this mode                             |
| `SPACE_NOT_FOUND`     | 404  | Unknown or inactive space                                     |
| `NOT_FOUND`           | 404  | Unknown route                                                 |
| `PRICING_UNAVAILABLE` | 503  | The space has no single-slot price configured                 |
| `INTERNAL_ERROR`      | 500  | Unexpected error (logged server-side, details never exposed)  |

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
