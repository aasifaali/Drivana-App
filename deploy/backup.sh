#!/usr/bin/env bash
# Nightly SQLite backup. Install sqlite3 (apt install sqlite3), then add to crontab:
#   15 2 * * * /opt/drivana/deploy/backup.sh
# Copy the backups folder off the server too (rclone to Google Drive / Backblaze).
set -euo pipefail
DB=/opt/drivana/data/drivana.db
OUT=/opt/drivana/backups
mkdir -p "$OUT"
sqlite3 "$DB" ".backup '$OUT/drivana-$(date +%F).db'"
find "$OUT" -name 'drivana-*.db' -mtime +14 -delete
