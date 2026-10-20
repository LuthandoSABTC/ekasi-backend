-- Run as the postgres superuser in the tracker database, after tracker_schema.sql.
-- Roles are shared with the Stack & Study setup (created there); create if missing.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, service_role to authenticator;
grant usage on schema public to service_role, anon;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
