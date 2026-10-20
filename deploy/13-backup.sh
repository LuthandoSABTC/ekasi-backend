#!/usr/bin/env bash
# Tracker — nightly backup of its database. Install once:  bash deploy/13-backup.sh install
set -euo pipefail
OUT=/opt/shalakasi/backups
if [ "${1:-}" = install ]; then
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
  install -d -m 700 "$OUT"; cp "$0" /usr/local/bin/tracker-backup; chmod 755 /usr/local/bin/tracker-backup
  echo "27 2 * * * root /usr/local/bin/tracker-backup >> /var/log/tracker-backup.log 2>&1" > /etc/cron.d/tracker-backup
  /usr/local/bin/tracker-backup && echo "Installed. Runs every night at 02:27."; exit 0
fi
. /opt/shalakasi/pg/info.env
D=$(date +%Y%m%d-%H%M%S)
sudo -u postgres pg_dump -p "$PGPORT" -Fc tracker > "$OUT/tracker-$D.dump"; chmod 600 "$OUT/tracker-$D.dump"
find "$OUT" -name 'tracker-*.dump' -mtime +14 -delete
echo "$(date -Is) tracker backup ok"
