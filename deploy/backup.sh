#!/bin/sh
# Sao lưu 3 database mỗi ngày lúc ~BACKUP_HOUR (giờ VN), giữ BACKUP_KEEP_DAYS ngày.
set -eu
HOUR="${BACKUP_HOUR:-2}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
while true; do
  # Chờ tới đầu giờ HOUR tiếp theo.
  now=$(date +%s)
  next=$(date -d "$(date +%F) ${HOUR}:00:00" +%s)
  if [ "$next" -le "$now" ]; then next=$((next + 86400)); fi
  sleep $((next - now))

  stamp=$(date +%F_%H%M)
  for db in "$DB_NAME_CORE" "$DB_NAME_CRM" "$DB_NAME_LMS"; do
    out="/backups/${db}_${stamp}.sql.gz"
    if mariadb-dump -h db -u root -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --databases "$db" | gzip > "$out.tmp"; then
      mv "$out.tmp" "$out"
      echo "$(date) backup ok: $out"
    else
      rm -f "$out.tmp"
      echo "$(date) BACKUP FAILED: $db" >&2
    fi
  done
  find /backups -name '*.sql.gz' -mtime +"$KEEP" -delete
done
