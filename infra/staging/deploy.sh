#!/usr/bin/env bash
# Deploys one image tag on the staging server. Run by GitHub Actions after each merge to main,
# or by hand to roll back:  ./deploy.sh <tag>   (tags = git commit SHAs, see docs/deployment.md)
#
# Steps: pull the images, start MySQL, run the migrations, seed on the very first deploy only,
# start everything, then wait until the site answers through HTTPS. Stops at the first error;
# the previous containers keep running until `up -d` replaces them.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image tag>}"
# Image tags are commit SHAs (or "smoke" in CI): refuse anything else, so the value can never
# carry shell or Compose syntax.
[[ "${TAG}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid image tag: ${TAG}" >&2; exit 1; }
cd "$(dirname "$0")"
[ -f .env ] || { echo "Missing .env (run setup-server.sh first)" >&2; exit 1; }

PREVIOUS="$(sed -n 's/^IMAGE_TAG=//p' release.env 2>/dev/null || true)"
echo "IMAGE_TAG=${TAG}" > release.env.next

dc() { docker compose --env-file .env --env-file release.env.next "$@"; }

echo "==> Deploying ${TAG} (previous: ${PREVIOUS:-none})"
# SKIP_PULL=1: the images were built on this machine (CI smoke test).
[ "${SKIP_PULL:-}" = 1 ] || dc pull --quiet api web

echo "==> Starting the database"
dc up -d --wait mysql mailpit

echo "==> Migrations"
dc run --rm --no-deps api node dist/database/cli.js latest

# The seed rewrites opening hours and space settings: run it only when the database is empty,
# so the client's changes in the admin survive later deploys.
# shellcheck disable=SC2016 # $MYSQL_PASSWORD is expanded inside the mysql container
SPACES="$(dc exec -T mysql sh -c 'mysql -ubovann -p"$MYSQL_PASSWORD" bovann -Nse "SELECT COUNT(*) FROM t_spaces" 2>/dev/null')"
case "${SPACES}" in
  ''|*[!0-9]*) echo "Could not read t_spaces from the database (got: '${SPACES}')" >&2; exit 1 ;;
esac
if [ "${SPACES}" = "0" ]; then
  echo "==> First deploy: seeding reference data"
  dc run --rm --no-deps api node dist/database/seed.js
fi

echo "==> Starting ${TAG}"
dc up -d --wait --remove-orphans
mv release.env.next release.env

DOMAIN="$(sed -n 's/^STAGING_DOMAIN=//p' .env | tr -d "'\"")"
echo "==> Checking https://${DOMAIN}/healthz"
CURL_OPTS=(-fsS --max-time 5)
# The CI smoke test runs with a local certificate authority (CURL_INSECURE=1); never set on the server.
[ "${CURL_INSECURE:-}" = 1 ] && CURL_OPTS+=(-k)
for _ in $(seq 1 30); do
  if curl "${CURL_OPTS[@]}" "https://${DOMAIN}/healthz" > /dev/null; then
    echo "==> Staging is up on ${TAG}"
    # Keep the images of this deploy and the previous one (for a quick rollback); older ones
    # would slowly fill the disk. ghcr.io keeps them all, so any rollback can pull again.
    docker image ls --format '{{.Repository}}:{{.Tag}}' \
      | grep -E '/bovann-(api|web-staging):' \
      | grep -vE ":(${TAG}${PREVIOUS:+|${PREVIOUS}})$" \
      | xargs -r docker image rm > /dev/null 2>&1 || true
    docker image prune -f > /dev/null
    exit 0
  fi
  sleep 4
done
echo "Staging did not answer after deploying ${TAG}. Roll back with: ./deploy.sh ${PREVIOUS:-<previous tag>}" >&2
dc logs --tail 80 api web caddy >&2
exit 1
