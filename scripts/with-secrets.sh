#!/bin/sh
# Runs a command with DIRECTUS_TOKEN fetched from Infisical, so the token never
# sits in .env. Needs the infisical CLI logged in and INFISICAL_PROJECT_ID in .env.
#   scripts/with-secrets.sh npm --prefix migrator run backfill-headlines
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=${INFISICAL_PROJECT_ID:-$(sed -n 's/^INFISICAL_PROJECT_ID=//p' "$ROOT/.env" | tr -d '" ')}
[ -n "$PROJECT" ] || { echo "INFISICAL_PROJECT_ID not set (env or .env)" >&2; exit 1; }
DIRECTUS_TOKEN=$(infisical secrets get htm_directus_token --projectId "$PROJECT" \
  --env "${INFISICAL_ENV:-dev}" --plain --silent)
[ -n "$DIRECTUS_TOKEN" ] || { echo "could not fetch htm_directus_token from Infisical" >&2; exit 1; }
export DIRECTUS_TOKEN
exec "$@"
