-- Rewards earned in Stack & Study (passing a chapter review or a book test), waiting in the tracker for approval.
-- pending -> approved (adds the sats to the student's bonus, so the normal Friday payout pays them) -> paid (once the student's paid total has caught up)
-- or pending -> rejected. `ref` is the Stack & Study reward id, so a reward can never be added twice.
create table if not exists stack_rewards (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  student_id uuid not null references students(id) on delete cascade,
  kind text not null default 'chapter',
  label text not null,
  amount_sats integer not null check (amount_sats > 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists stack_rewards_status_idx on stack_rewards (status);
alter table stack_rewards enable row level security;
grant select, insert, update, delete on stack_rewards to service_role;
notify pgrst, 'reload schema';
