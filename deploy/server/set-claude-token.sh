#!/usr/bin/env bash
# Let Boussole on your server use Claude with your own subscription.
#
#   1. On your Mac:  claude setup-token      (copy the token it prints)
#   2. Then:         deploy/server/set-claude-token.sh debian@my-server
#
# The token is typed hidden, sent over SSH, stored only in the server's
# $BOUSSOLE_HOME/.env (mode 600), and Boussole restarts to pick it up.
set -euo pipefail

target="${1:?usage: set-claude-token.sh user@server}"
home="${BOUSSOLE_HOME:-/opt/boussole}"

read -r -s -p "Paste the token from 'claude setup-token' (hidden): " token
echo
if [[ "$token" != sk-ant-* ]]; then
  echo "That doesn't look like a Claude token (they start with sk-ant-). Nothing changed." >&2
  exit 1
fi

# The first input line is the token, the rest is the script run on the server,
# so the token never appears on a command line.
{
  printf '%s\n' "$token"
  cat <<'REMOTE'
set -euo pipefail
env_file="$BOUSSOLE_HOME/.env"
umask 077
touch "$env_file"
grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' "$env_file" >"$env_file.tmp" || true
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_TOKEN" >>"$env_file.tmp"
mv "$env_file.tmp" "$env_file"
docker compose -f "$BOUSSOLE_HOME/repo/deploy/server/compose.yml" up -d --force-recreate --no-build >/dev/null
echo "Token saved on the server; Boussole restarted."
REMOTE
} | ssh "$target" "BOUSSOLE_HOME='$home' bash -c 'IFS= read -r CLAUDE_TOKEN && export CLAUDE_TOKEN && exec bash -s'"
