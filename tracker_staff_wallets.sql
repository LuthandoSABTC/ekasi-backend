-- Read-only Blink keys that staff chose to share, so the admin can see their wallet balance.
-- The key is stored encrypted (AES-256-GCM, secret WALLET_KEY_SECRET in the backend's .env).
-- Not in the backend's /db list, so no page can read this table. Removing a staff member removes their key.
create table if not exists staff_wallet_keys (
  staff_id uuid primary key references staff(id) on delete cascade,
  provider text not null default 'blink',
  key_enc text not null,
  key_hint text,
  scopes text,
  consent_by text,
  added_at timestamptz not null default now()
);
alter table staff_wallet_keys enable row level security;
revoke all on staff_wallet_keys from anon;
grant select, insert, update, delete on staff_wallet_keys to service_role;
notify pgrst, 'reload schema';
