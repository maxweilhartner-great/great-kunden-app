#!/usr/bin/env bash
# Plattform-Zugangsdaten am Server eintragen – fragt die Werte ab (Geheimnisse unsichtbar)
# und startet die App neu. Aufruf als root:
#   bash /opt/great-video-ai/video-ai/deploy/zugang.sh meta|instagram|linkedin|youtube|tiktok|epidemic
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  meta)     FELDER="META_APP_ID META_APP_SECRET" ;;
  instagram) FELDER="INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET" ;;
  linkedin) FELDER="LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET" ;;
  youtube)  FELDER="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET" ;;
  tiktok)   FELDER="TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET" ;;
  epidemic) FELDER="EPIDEMIC_API_KEY" ;;
  *) echo "Aufruf: bash deploy/zugang.sh meta|instagram|linkedin|youtube|tiktok|epidemic"; exit 1 ;;
esac

[ -f .env ] || { echo ".env fehlt – zuerst install.sh ausführen."; exit 1; }

for KEY in $FELDER; do
  if [[ "$KEY" == *SECRET* || "$KEY" == *API_KEY* ]]; then
    read -r -s -p "$KEY (Eingabe unsichtbar, Rechtsklick fügt ein): " WERT; echo
  else
    read -r -p "$KEY: " WERT
  fi
  WERT="$(printf '%s' "$WERT" | tr -d '[:space:]')"
  [ -n "$WERT" ] || { echo "Leer – abgebrochen."; exit 1; }
  if grep -q "^$KEY=" .env; then
    sed -i "s#^$KEY=.*#$KEY=$WERT#" .env
  else
    echo "$KEY=$WERT" >> .env
  fi
done

echo "==> App wird neu gestartet …"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --force-recreate app
echo "Fertig. In der Video-App unter „Konten“ kann jetzt verbunden werden."
