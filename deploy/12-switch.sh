#!/usr/bin/env bash
# Tracker — step 3: start the backend on this server (the cutover). Run as root AFTER 11-copy-data.sh.
# Before running: the Render backend must be STOPPED (Render → ekasi-backend → Settings → Suspend),
# otherwise both would send the daily/weekly messages and bonuses twice.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
grep -qE '^GMAIL_APP_PASSWORD=.+' /opt/ekasi-backend/.env || echo "WARNING: GMAIL_APP_PASSWORD is empty in /opt/ekasi-backend/.env — emails will not be sent."
systemctl enable --now ekasi-backend >/dev/null 2>&1; systemctl restart ekasi-backend; sleep 3
curl -s https://tracker.learn-bitcoinekasi.it.com/ ; echo
journalctl -u ekasi-backend -n 5 --no-pager
echo "Backend is running here. Next: publish the page changes (frontend patch), then test a teacher login."
