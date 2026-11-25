#!/bin/bash
# Database backups for staging, run inside the `backup` container (mysql:8.0 image).
#   backup.sh          every night at 02:00 UTC, keeps the last 14 dumps in /backups
#   backup.sh once     one dump now (used by the CI smoke test and by hand)
# A dump counts only if mysqldump succeeded AND wrote its "Dump completed" trailer; otherwise
# the partial file is deleted and the error is logged, so a bad dump never pushes out good ones.
set -euo pipefail

KEEP=14

dump() {
  local file
  file="/backups/bovann-$(date -u +%Y%m%d-%H%M%S).sql.gz"
  if mysqldump -h mysql -u bovann --single-transaction --routines --no-tablespaces bovann \
    | gzip > "${file}.tmp" \
    && gzip -t "${file}.tmp" \
    && gzip -dc "${file}.tmp" | tail -n 1 | grep -q 'Dump completed'; then
    mv "${file}.tmp" "${file}"
    echo "backup ok ${file} ($(du -h "${file}" | cut -f1))"
  else
    rm -f "${file}.tmp"
    echo "backup FAILED at $(date -u +%FT%TZ)" >&2
    return 1
  fi
  # Keep the newest $KEEP dumps.
  find /backups -maxdepth 1 -name 'bovann-*.sql.gz' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | xargs -r rm -f
}

if [ "${1:-}" = once ]; then
  dump
  exit
fi

while true; do
  now="$(date -u +%s)"
  next="$(date -u -d 'today 02:00' +%s)"
  [ "${next}" -gt "${now}" ] || next="$(date -u -d 'tomorrow 02:00' +%s)"
  sleep $((next - now))
  dump || true # logged above; try again the next night
done
