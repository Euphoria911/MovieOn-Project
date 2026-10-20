#!/usr/bin/env bash
# One-time setup: install server deps and generate secrets for this codespace.
set -euo pipefail

cd "$(dirname "$0")/.."
WORKSPACE="$(pwd)"
mkdir -p "$WORKSPACE/data"

ENV_FILE="$WORKSPACE/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '=/+' | cut -c1-20)

  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
DB_PATH=$WORKSPACE/data/movieon.db
COOKIE_SECURE=true
TRUST_PROXY=1
SEED_DEMO=true
BILLING_PROVIDER=none
ADMIN_EMAIL=umidloh2@gmail.com
ADMIN_PASSWORD=$ADMIN_PASSWORD
JWT_SECRET=$JWT_SECRET
EOF
  chmod 600 "$ENV_FILE"

  echo "$ADMIN_PASSWORD" > "$WORKSPACE/data/ADMIN_PASSWORD.txt"

  cat <<MSG

=====================================================
  MovieOn admin login (generated once, saved in codespace)
    Email:    umidloh2@gmail.com
    Password: $ADMIN_PASSWORD
  Also saved to: data/ADMIN_PASSWORD.txt
=====================================================

MSG
fi

cd "$WORKSPACE/server"
npm ci
