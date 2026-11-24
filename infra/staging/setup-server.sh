#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server for staging. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/CHRISTIAN-KEVEN/bovann-booking/main/infra/staging/setup-server.sh -o setup-server.sh
#   bash setup-server.sh staging.example.com "ssh-ed25519 AAAA... github-deploy"
#
# Arguments: the staging domain (its DNS A record must already point to this server) and the
# PUBLIC half of the deploy key that GitHub Actions will use (see docs/deployment.md).
#
# It installs Docker, opens only SSH/HTTP/HTTPS, turns on automatic security updates, creates the
# `deploy` user, and writes /opt/bovann/staging/.env with fresh random secrets. Safe to re-run:
# an existing .env is kept.
set -euo pipefail

DOMAIN="${1:?usage: setup-server.sh <staging domain> \"<deploy public key>\"}"
DEPLOY_KEY="${2:?usage: setup-server.sh <staging domain> \"<deploy public key>\"}"
APP_DIR=/opt/bovann/staging
IMAGE_REPO=ghcr.io/christian-keven

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
case "${DEPLOY_KEY}" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *)
  echo "The second argument must be an SSH PUBLIC key (ssh-ed25519 ...). Never paste the private key here." >&2; exit 1;;
esac

echo "==> System updates and tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl ufw unattended-upgrades openssl
dpkg-reconfigure -fnoninteractive unattended-upgrades

if ! command -v docker > /dev/null; then
  echo "==> Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> deploy user (used only by GitHub Actions)"
id deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "${DEPLOY_KEY}" /home/deploy/.ssh/authorized_keys 2>/dev/null \
  || echo "${DEPLOY_KEY}" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy "${APP_DIR}"
if [ -f "${APP_DIR}/.env" ]; then
  echo "==> ${APP_DIR}/.env already exists: kept as is"
else
  echo "==> Secrets"
  SITE_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  SITE_HASH="$(docker run --rm caddy:2.10 caddy hash-password --plaintext "${SITE_PASSWORD}")"
  umask 077
  cat > "${APP_DIR}/.env" <<EOF
# Staging secrets. Never commit or share this file. Single quotes keep the \$ in the hash literal.
STAGING_DOMAIN=${DOMAIN}
IMAGE_REPO=${IMAGE_REPO}
MYSQL_ROOT_PASSWORD='$(openssl rand -hex 24)'
MYSQL_PASSWORD='$(openssl rand -hex 24)'
OTP_SECRET='$(openssl rand -base64 48 | tr -d '\n')'
STAGING_AUTH_USER=bovann
STAGING_AUTH_HASH='${SITE_HASH}'
# Optional:
# STUDIO_CONTACT_PHONE='+228 90 00 00 00'
# SEED_OWNER_EMAILS=owners@example.com
EOF
  chown deploy:deploy "${APP_DIR}/.env"
  echo
  echo "Site password for https://${DOMAIN} (user: bovann). Shown once, store it in your password manager:"
  echo "    ${SITE_PASSWORD}"
  echo
fi

echo "==> Done. Next: add the GitHub secrets (docs/deployment.md), then merge or re-run the deploy workflow."
