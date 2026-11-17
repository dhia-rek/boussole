#!/usr/bin/env bash
# One-time setup of Boussole on a Linux server with Docker and Tailscale.
# Creates $BOUSSOLE_HOME (code, data, .env), builds and starts the container,
# schedules automatic updates and publishes it privately on your tailnet.
#
#   git clone https://github.com/dhia-rek/boussole.git /tmp/boussole
#   /tmp/boussole/deploy/server/install.sh
set -euo pipefail

BOUSSOLE_HOME="${BOUSSOLE_HOME:-/opt/boussole}"
REPO_URL="${BOUSSOLE_REPO_URL:-https://github.com/dhia-rek/boussole.git}"
PORT="${BOUSSOLE_PORT:-3005}"
HTTPS_PORT="${BOUSSOLE_HTTPS_PORT:-8443}"
RUN_USER="$(id -un)"

for tool in docker git curl jq flock tailscale; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool: install it first." >&2
    exit 1
  fi
done

sudo mkdir -p "$BOUSSOLE_HOME/data"
sudo chown -R "$RUN_USER": "$BOUSSOLE_HOME"
if [[ ! -d "$BOUSSOLE_HOME/repo/.git" ]]; then
  git clone --quiet "$REPO_URL" "$BOUSSOLE_HOME/repo"
fi

units="$BOUSSOLE_HOME/repo/deploy/server"
sed -e "s|@USER@|$RUN_USER|g" -e "s|@HOME@|$BOUSSOLE_HOME|g" \
  "$units/boussole-deploy.service" | sudo tee /etc/systemd/system/boussole-deploy.service >/dev/null
sudo install -m 0644 "$units/boussole-deploy.timer" /etc/systemd/system/boussole-deploy.timer
sudo systemctl daemon-reload

echo "Building and starting Boussole (the first build takes several minutes)..."
BOUSSOLE_HOME="$BOUSSOLE_HOME" "$units/deploy.sh" --force

sudo systemctl enable --now boussole-deploy.timer
sudo tailscale serve --bg --https="$HTTPS_PORT" "http://127.0.0.1:$PORT" >/dev/null

host=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')
echo "Boussole is running at https://$host:$HTTPS_PORT (only your Tailscale devices can open it)."
