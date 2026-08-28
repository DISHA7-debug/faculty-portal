#!/bin/sh
# Nightly encrypted database backup to Cloudflare R2.
# Install on the VPS:  0 2 * * * /opt/faculty-portal/deploy/backup.sh >> /var/log/faculty-backup.log 2>&1
#
# Runs on the host: since the DB moved to Neon (docs/CUTOVER.md §0.5) there is no local
# `faculty_postgres` container to `docker exec` into anymore, so this dumps straight
# over the network instead. Needs NEON_DATABASE_URL present in the environment (same
# way BACKUP_PASSPHRASE already is, from /root/.backup-env).
#
# This is Neon-native backup's belt; Neon's own PITR is the suspenders — see
# docs/CUTOVER.md's backup section for why both exist.
set -eu

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="/tmp/faculty_${STAMP}.sql.gz"

# pg_dump/libpq reject query parameters they don't recognise, and `pgbouncer=true` on
# NEON_DATABASE_URL is a Prisma-only flag (see the comment next to it in .env) — strip
# it before use. sslmode and channel_binding are standard libpq parameters and pass
# through untouched, in whatever order they appear.
DUMP_URL=$(printf '%s' "$NEON_DATABASE_URL" | sed -E \
  -e 's/&pgbouncer=[^&]*//' \
  -e 's/\?pgbouncer=[^&]*&/?/' \
  -e 's/\?pgbouncer=[^&]*$//')

# Run pg_dump inside a Postgres container matching Neon's server major version, rather
# than a host-installed client that has to be kept in lockstep with it. pg_dump refuses
# to dump from a server major version newer than itself — confirmed directly: Neon
# currently runs Postgres 18, and this repo's own postgres:16-alpine (the dev/VPS-Postgres
# image, see docker-compose.yml) can't touch it. Bump the tag below if Neon's Postgres
# major version ever changes (check with: SELECT version(); against NEON_DATABASE_URL).
docker run --rm postgres:18-alpine pg_dump "$DUMP_URL" \
  | gzip -9 > "$FILE"

# Encrypt at rest. BACKUP_PASSPHRASE lives in /root/.backup-env, chmod 600.
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_PASSPHRASE" -o "${FILE}.gpg" "$FILE"

aws s3 cp "${FILE}.gpg" "s3://${R2_BACKUP_BUCKET}/db/" \
    --endpoint-url "$R2_ENDPOINT"

rm -f "$FILE" "${FILE}.gpg"

# Retain 30 days
CUTOFF=$(date -d '30 days ago' +%Y-%m-%d)
aws s3 ls "s3://${R2_BACKUP_BUCKET}/db/" --endpoint-url "$R2_ENDPOINT" \
  | awk -v c="$CUTOFF" '$1 < c {print $4}' \
  | while read -r old; do
      aws s3 rm "s3://${R2_BACKUP_BUCKET}/db/${old}" --endpoint-url "$R2_ENDPOINT"
    done

echo "[$(date)] backup ok: faculty_${STAMP}.sql.gz.gpg"
