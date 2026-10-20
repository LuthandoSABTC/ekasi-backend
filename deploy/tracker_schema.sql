-- Bitcoin Ekasi Attendance Tracker — schema for self-hosted Postgres.
-- Mirrors the live Supabase project (bnteowvyioptlvohyert), 15 tables.
create table teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  class_name text not null,
  password text not null,
  created_at timestamp default now()
);
create table students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id) on delete cascade,
  name text not null,
  destination text not null,
  paid integer default 0,
  created_at timestamp default now(),
  graduated boolean default false,
  graduated_at timestamp,
  bonus integer default 0,
  status text default 'active',
  cohort text default '2026',
  final_test_score integer,
  final_test_date date,
  round_start_date date,
  round_start_paid integer
);
create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  date text not null,
  created_at timestamp default now(),
  present boolean default true,
  unique (student_id, date)
);
create table chapters (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id),
  date date not null,
  chapter integer not null,
  notes text,
  created_at timestamptz default now()
);
create table excuses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  date date not null,
  reason text not null,
  created_at timestamptz default now(),
  unique (student_id, date)
);
create table heat_watch_state (
  heat_id text not null,
  athlete text not null,
  status text not null,
  place integer,
  total numeric,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  scheduled_time timestamptz,
  primary key (heat_id, athlete)
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pay_table text,
  pay_id uuid,
  recipient_name text,
  destination text,
  amount integer not null,
  event text not null,
  blink_status text,
  detail text
);
create index payments_created_at_idx on payments (created_at);
create index payments_pay_table_pay_id_idx on payments (pay_table, pay_id);
create table postgrad_students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid,
  cohort text default 'Postgrad Cohort 1 - 2026',
  status text default 'active',
  created_at timestamptz default now(),
  student_id text
);
create table postgrad_attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references postgrad_students(id) on delete cascade,
  date date not null,
  created_at timestamptz default now(),
  unique (student_id, date)
);
create table postgrad_excuses (
  uuid uuid primary key default gen_random_uuid(),
  created_at date not null default now(),
  student_id uuid,
  date date,
  reason text
);
create table shack_owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sponsor_name text not null,
  destination text not null,
  paid_months integer default 0,
  last_paid_month text default '',
  created_at timestamptz default now()
);
create table shack_checkins (
  id uuid primary key default gen_random_uuid(),
  shack_owner_id uuid references shack_owners(id) on delete cascade,
  month text not null,
  checked_in boolean default true,
  created_at timestamptz default now(),
  unique (shack_owner_id, month)
);
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text default 'Teaching Assistant',
  destination text not null,
  paid integer default 0,
  created_at timestamptz default now(),
  whatsapp_number text default '+27616706847 ',
  callmebot_apikey text default '2282131',
  telegram_chat_id text,
  bonus integer
);
create table staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) on delete cascade,
  date date not null,
  hours numeric not null default 1,
  created_at timestamptz default now(),
  unique (staff_id, date)
);
create table surf_spots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  latitude double precision not null,
  longitude double precision not null,
  break_type text,
  skill_level text check (skill_level in ('beginner','intermediate','advanced','all levels')),
  best_swell_direction text,
  best_wind_direction text,
  best_tide text,
  hazards text,
  notes text,
  kid_friendly boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
