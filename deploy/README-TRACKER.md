# Moving the Attendance Tracker to our own server

Everything on the server runs as root from `/opt/ekasi-backend`. Render and Supabase are left untouched
until the final step, and Supabase stays as a fallback.

## Preparation (nobody is affected)
1. DNS: an **A** record `tracker` → `89.125.10.8` in the `learn-bitcoinekasi.it.com` zone.
2. `cd /opt && git clone https://github.com/LuthandoSABTC/ekasi-backend && cd ekasi-backend` (use the branch with these scripts)
3. `bash deploy/10-setup.sh` — database, keys, backend (not started), web address. Ends with "OK".
4. `nano /opt/ekasi-backend/.env` — fill in the values from Render → Environment (Gmail app password,
   Telegram token, CallMeBot number/key).
5. `bash deploy/13-backup.sh install` — nightly backup of the tracker database.

## The switch (a few minutes)
1. Suspend the Render backend (Render → ekasi-backend → Settings → Suspend) — right after the 19:00 summary has gone out.
2. `bash deploy/11-copy-data.sh <<< '<tracker Supabase session-pooler string>'` — must end with "All tables match."
3. `bash deploy/12-switch.sh` — starts the backend here.
4. Publish the page patch (bitcoinekasi repo) so the pages point at `tracker.learn-bitcoinekasi.it.com`.
5. Test: teacher login, mark attendance, admin page, leaderboard.

## Go back
Resume Render; revert the page patch (GitHub → revert the commit). `systemctl stop ekasi-backend`.
Supabase still holds the data as it was at the copy; anything recorded here after the switch is not in it.
