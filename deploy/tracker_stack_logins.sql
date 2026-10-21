-- Stack & Study logins seen by the tracker. One row per student per day.
-- Kept apart from `attendance` on purpose: nothing here is ever counted for sats.
create table if not exists stack_logins (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'diploma' check (kind in ('diploma','postgrad')),
  student_id uuid not null,
  date text not null,
  in_class boolean not null default false,
  first_login_at timestamptz not null default now(),
  unique (kind, student_id, date)
);
alter table stack_logins enable row level security;
grant select, insert, update, delete on stack_logins to service_role;
notify pgrst, 'reload schema';
