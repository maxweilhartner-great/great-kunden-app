#!/usr/bin/env bash
# GR·EAT Video AI – Installation auf einem frischen Ubuntu-Server (22.04/24.04), z. B. Hetzner Cloud.
#
# Aufruf (als root auf dem Server):
#   curl -fsSL https://raw.githubusercontent.com/maxweilhartner-great/great-kunden-app/main/video-ai/deploy/install.sh | bash -s -- video.great.at
#
# Erneut ausführen = aktualisieren (holt den neuesten Stand und baut neu; Daten und Passwörter bleiben).
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/maxweilhartner-great/great-kunden-app.git"
DIR="/opt/great-video-ai"

if [ "$(id -u)" -ne 0 ]; then echo "Bitte als root ausführen."; exit 1; fi

echo "==> Docker installieren (falls nötig)"
if ! command -v docker >/dev/null; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl git ufw openssl
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null || apt-get install -y -q git

echo "==> Firewall: nur SSH, HTTP, HTTPS"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

echo "==> Programm holen"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR/video-ai"

if [ ! -f .env ]; then
  if [ -z "$DOMAIN" ]; then echo "Bitte die Adresse angeben, z. B.: bash install.sh video.great.at"; exit 1; fi
  echo "==> Erstkonfiguration für $DOMAIN"
  TEAM_PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-10)"
  ADMIN_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-14)"
  sed -e "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" \
      -e "s#^SESSION_SECRET=.*#SESSION_SECRET=$(openssl rand -hex 32)#" \
      -e "s#^TEAM_PASSWORD=.*#TEAM_PASSWORD=$TEAM_PW#" \
      -e "s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=$ADMIN_PW#" \
      .env.example > .env
  chmod 600 .env
  echo "DOMAIN=$DOMAIN" > deploy/.env
  NEU=1
fi

echo "==> Bauen und starten (beim ersten Mal ca. 5–10 Minuten, lädt auch das Whisper-Modell)"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker image prune -f >/dev/null

DOMAIN="$(sed -n 's/^DOMAIN=//p' deploy/.env)"
echo
echo "Fertig: https://$DOMAIN"
if [ "${NEU:-0}" = 1 ]; then
  echo
  echo "  Team-Passwort (Hochladen):          $TEAM_PW"
  echo "  Admin-Passwort (Freigabe & Konten): $ADMIN_PW"
  echo
  echo "  Bitte notieren! Ändern: nano $DIR/video-ai/.env, danach dieses Skript erneut ausführen."
fi
echo "  Plattform-Zugangsdaten (Meta, LinkedIn, Google, TikTok) ebenfalls in $DIR/video-ai/.env eintragen."
echo "  Musik: lizenzfreie Stücke nach $DIR/video-ai/brand/music/ kopieren (wirkt sofort)."
