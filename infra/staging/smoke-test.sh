#!/usr/bin/env bash
# Checks a running staging site from the outside, the way a visitor would.
#
#   STAGING_PASSWORD=... ./smoke-test.sh staging.example.com           read-only checks
#   STAGING_PASSWORD=... ./smoke-test.sh staging.example.com --book    also books a slot and pays
#                                                                      (simulated), then checks the
#                                                                      owners' email arrived
# Optional: STAGING_USER (default bovann), CURL_INSECURE=1 for a local certificate authority (CI).
# Exits non-zero at the first failed check, printing what was expected and what came back.
set -euo pipefail

DOMAIN="${1:?usage: smoke-test.sh <domain> [--book]}"
BOOK="${2:-}"
USER_NAME="${STAGING_USER:-bovann}"
: "${STAGING_PASSWORD:?set STAGING_PASSWORD}"
BASE="https://${DOMAIN}"
SPACE=studio-principal-lome

CURL=(curl -sS --max-time 20)
[ "${CURL_INSECURE:-}" = 1 ] && CURL+=(-k)
AUTH=(-u "${USER_NAME}:${STAGING_PASSWORD}")

pass() { echo "  ok  $*"; }
fail() { echo "FAIL  $*" >&2; exit 1; }

status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

expect_status() {
  local want="$1" label="$2"; shift 2
  local got; got="$(status "$@")"
  [ "${got}" = "${want}" ] || fail "${label}: expected HTTP ${want}, got ${got}"
  pass "${label} (${got})"
}

echo "Smoke test of ${BASE}"

# --- Access rules ----------------------------------------------------------------------------
expect_status 401 "site asks for the password" "${BASE}/"
expect_status 401 "API asks for the password" "${BASE}/api/v1/spaces/${SPACE}"
expect_status 200 "health check is open" "${BASE}/healthz"
robots="$("${CURL[@]}" -D - -o /dev/null "${AUTH[@]}" "${BASE}/")"
grep -qi '^x-robots-tag: noindex' <<< "${robots}" || fail "pages must carry X-Robots-Tag: noindex"
pass "pages are hidden from search engines"

# --- Pages -----------------------------------------------------------------------------------
for path in / /en /reserver/date /en-direct /en/en-direct /mes-reservations /conditions /admin/connexion /vendeur/connexion; do
  expect_status 200 "page ${path}" "${AUTH[@]}" "${BASE}${path}"
done
expect_status 200 "email inbox (Mailpit)" "${AUTH[@]}" "${BASE}/mailpit/"

# --- API -------------------------------------------------------------------------------------
space="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/api/v1/spaces/${SPACE}")" || fail "space details"
today="$(jq -r '.booking.today' <<< "${space}")"
[ -n "${today}" ] && [ "${today}" != null ] || fail "space details without today's date"
pass "API answers (studio today: ${today})"
lives="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/api/v1/lives")" || fail "live wall"
jq -e '.categories | length > 0' > /dev/null <<< "${lives}" || fail "live wall without categories"
pass "live wall answers"

[ "${BOOK}" = "--book" ] || { echo "All read-only checks passed."; exit 0; }

# --- A booking paid with the simulated provider ----------------------------------------------
echo "Booking a slot (simulated payment)"
start=""
for month in "${today:0:7}" "$(date -u -d "${today:0:7}-01 +1 month" +%Y-%m)"; do
  days="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/api/v1/spaces/${SPACE}/availability?month=${month}")"
  for day in $(jq -r '.days[] | select(.status == "AVAILABLE" or .status == "FEW") | .date' <<< "${days}"); do
    start="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/api/v1/spaces/${SPACE}/availability/${day}?mode=IN_PERSON" \
      | jq -r '[.slots[] | select(.status == "AVAILABLE")][0].start // empty')"
    [ -n "${start}" ] && break 2
  done
done
[ -n "${start}" ] || fail "no free slot in the next two months"
pass "free slot found: ${start}"

body="$(jq -n --arg start "${start}" --arg space "${SPACE}" '{
  spaceSlug: $space, mode: "IN_PERSON",
  selection: { type: "SLOTS", slotStarts: [$start] },
  customer: { fullName: "Test Smoke", phone: "+22890000099", email: null,
              businessName: "Smoke test", businessSector: "Autre" },
  liveDescription: "Automatic staging check",
  acceptTerms: true,
  payment: { method: "MOBILE_MONEY", channel: "TMONEY", payerPhone: "+22890000099" }
}')"
created="$("${CURL[@]}" -f "${AUTH[@]}" -H 'Content-Type: application/json' -d "${body}" \
  "${BASE}/api/v1/bookings")" || fail "booking refused"
ref="$(jq -r '.booking.reference' <<< "${created}")"
token="$(jq -r '.accessToken' <<< "${created}")"
[ "$(jq -r '.booking.status' <<< "${created}")" = PENDING_PAYMENT ] || fail "booking not waiting for payment"
pass "slot held, booking ${ref}"

before="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/mailpit/api/v1/messages?limit=1" | jq '.total')"
"${CURL[@]}" -f "${AUTH[@]}" -X POST "${BASE}/api/v1/dev/payments/${ref}/succeed" > /dev/null \
  || fail "simulated payment refused (is staging running with DEPLOY_ENV=staging?)"
booking="$("${CURL[@]}" -f "${AUTH[@]}" -H "X-Booking-Token: ${token}" "${BASE}/api/v1/bookings/${ref}")"
[ "$(jq -r '.status' <<< "${booking}")" = CONFIRMED ] || fail "booking not confirmed after payment"
pass "payment simulated, booking confirmed"

expect_status 200 "receipt PDF" "${AUTH[@]}" -H "X-Booking-Token: ${token}" "${BASE}/api/v1/bookings/${ref}/receipt"
expect_status 409 "the slot can't be booked twice" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "$(jq '.customer.phone = "+22890000098" | .payment.payerPhone = "+22890000098"' <<< "${body}")" \
  "${BASE}/api/v1/bookings"

for _ in $(seq 1 15); do
  after="$("${CURL[@]}" -f "${AUTH[@]}" "${BASE}/mailpit/api/v1/messages?limit=1" | jq '.total')"
  [ "${after}" -gt "${before}" ] && { pass "owners' email sent ($((after - before)) new)"; break; }
  sleep 3
done
[ "${after}" -gt "${before}" ] || fail "no email sent within 45 s of the payment"

echo "All checks passed."
