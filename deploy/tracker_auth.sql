-- Stage 2: settings table holding the admin password hash (RLS on, no policies: only service_role can touch it)
create table if not exists app_settings (
  key text primary key,
  value text
);
alter table app_settings enable row level security;
grant select, insert, update, delete on app_settings to service_role;
