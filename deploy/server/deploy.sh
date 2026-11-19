#!/usr/bin/env bash
# Pull-based continuous deployment for Boussole on a single server.
#
# Run every few minutes by boussole-deploy.timer. It deploys the newest commit
# of the branch only after every GitHub check on that commit has passed, keeps
# the previous image, and rolls back if the new one does not become healthy.
#
#   deploy.sh            deploy if a new green commit exists
#   deploy.sh --force    rebuild and redeploy the current commit
set -euo pipefail

main() {
  local home="${BOUSSOLE_HOME:-/opt/boussole}"
  local repo="$home/repo"
  local compose="$repo/deploy/server/compose.yml"
  # Server-only additions (extra volumes, settings) live outside the code.
  local files=(-f "$compose")
  if [[ -f "$home/compose.override.yml" ]]; then
    files+=(-f "$home/compose.override.yml")
  fi
  local github_repo="${BOUSSOLE_GITHUB_REPO:-dhia-rek/boussole}"
  local branch="${BOUSSOLE_BRANCH:-main}"
  local port="${BOUSSOLE_PORT:-3005}"
  local force="${1:-}"

  exec 9>"$home/deploy.lock"
  if ! flock -n 9; then
    log "another deploy is already running"
    return 0
  fi

  git -C "$repo" fetch --quiet origin "$branch"
  local target current
  target=$(git -C "$repo" rev-parse "origin/$branch")
  current=$(cat "$home/deployed-commit" 2>/dev/null || true)

  if [[ "$target" == "$current" && "$force" != "--force" ]]; then
    return 0
  fi
  if [[ "$target" == "$(cat "$home/failed-commit" 2>/dev/null || true)" && "$force" != "--force" ]]; then
    return 0
  fi

  if [[ "$force" != "--force" ]]; then
    local verdict
    verdict=$(checks_verdict "$github_repo" "$target")
    case "$verdict" in
      passed) ;;
      pending)
        log "waiting for GitHub checks on ${target:0:7}"
        return 0
        ;;
      *)
        log "not deploying ${target:0:7}: GitHub checks $verdict"
        echo "$target" >"$home/failed-commit"
        return 0
        ;;
    esac
  fi

  log "deploying ${target:0:7}"
  git -C "$repo" checkout --quiet --detach "$target"
  if docker image inspect boussole:current >/dev/null 2>&1; then
    docker tag boussole:current boussole:previous
  fi

  if ! BOUSSOLE_HOME="$home" docker compose "${files[@]}" build --quiet; then
    log "build failed for ${target:0:7}; keeping the running version"
    echo "$target" >"$home/failed-commit"
    return 1
  fi
  BOUSSOLE_HOME="$home" docker compose "${files[@]}" up -d

  if wait_healthy "$port"; then
    echo "$target" >"$home/deployed-commit"
    rm -f "$home/failed-commit"
    docker image prune -f >/dev/null
    log "deployed ${target:0:7}"
    return 0
  fi

  log "${target:0:7} did not become healthy; rolling back"
  echo "$target" >"$home/failed-commit"
  if docker image inspect boussole:previous >/dev/null 2>&1; then
    docker tag boussole:previous boussole:current
    BOUSSOLE_HOME="$home" docker compose "${files[@]}" up -d --no-build
    if [[ -n "$current" ]]; then
      git -C "$repo" checkout --quiet --detach "$current"
    fi
  fi
  return 1
}

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"
}

# passed | pending | failed: every check run on the commit must be completed
# with success, neutral or skipped.
checks_verdict() {
  local github_repo="$1" sha="$2" json
  if ! json=$(curl -fsS -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$github_repo/commits/$sha/check-runs?per_page=100"); then
    echo pending
    return
  fi
  jq -r '
    if .total_count == 0 then "pending"
    elif any(.check_runs[]; .status != "completed") then "pending"
    elif all(.check_runs[]; .conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped") then "passed"
    else "failed" end' <<<"$json"
}

wait_healthy() {
  local port="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# One line, so bash has read it completely before main() can move the
# checkout (and this file) to another commit.
main "$@"; exit $?
