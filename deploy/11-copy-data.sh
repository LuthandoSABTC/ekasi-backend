#!/usr/bin/env bash
# Tracker — step 2: copy all data from the tracker's Supabase project into our own database.
# Run as root on the server:   bash deploy/11-copy-data.sh <<< 'postgresql://postgres.bnteowvyioptlvohyert:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
# (Use the "Session pooler" string from Supabase → Connect for the tracker project.)
# Read-only on the Supabase side. Safe to re-run until the switch (it empties our copy first).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
. /opt/shalakasi/pg/info.env; DB=tracker; BIN=/usr/lib/postgresql/17/bin
if systemctl is-active --quiet ekasi-backend; then echo "The tracker backend is already running on our database. Re-running would erase newer data. Stopping."; exit 1; fi
TABLES="teachers students attendance chapters excuses heat_watch_state payments postgrad_students postgrad_attendance postgrad_excuses shack_owners shack_checkins staff staff_attendance surf_spots"
read -rs -p "" SRC || true; [ -n "${SRC:-}" ] || { echo "No connection string given."; exit 1; }
DUMP=$(mktemp /root/trk-dump.XXXXXX.sql); chmod 600 "$DUMP"; trap 'rm -f "$DUMP"' EXIT
args=(); for t in $TABLES; do args+=(-t "public.$t"); done
echo "== Reading from Supabase…"
"$BIN/pg_dump" "$SRC" --data-only --no-owner --no-privileges --disable-triggers "${args[@]}" -f "$DUMP"
echo "== Loading into our database…"
TL=$(echo $TABLES | sed 's/ /, /g')
sudo -u postgres psql -p "$PGPORT" -d "$DB" -v ON_ERROR_STOP=1 -q -c "truncate $TL restart identity cascade" -f - < "$DUMP" >/dev/null
echo "== Row counts (Supabase | ours) — they must match"
bad=0
for t in $TABLES; do
  a=$("$BIN/psql" "$SRC" -Atc "select count(*) from public.$t"); b=$(sudo -u postgres psql -p "$PGPORT" -d "$DB" -Atc "select count(*) from public.$t")
  m=ok; [ "$a" = "$b" ] || { m=MISMATCH; bad=1; }; printf '  %-20s %6s | %-6s %s\n' "$t" "$a" "$b" "$m"
done
[ $bad = 0 ] && echo "All tables match." || { echo "Some counts differ — do not switch; send me this output."; exit 1; }
