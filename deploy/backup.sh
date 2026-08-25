#!/bin/sh
# Nightly encrypted database backup to Cloudflare R2.
# Install on the VPS:  0 2 * * * /opt/faculty-portal/deploy/backup.sh >> /var/log/faculty-backup.log 2>&1
set -eu

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="/tmp/faculty_${STAMP}.sql.gz"

docker exec faculty_postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
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
