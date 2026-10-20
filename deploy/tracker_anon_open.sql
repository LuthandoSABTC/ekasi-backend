-- STAGE 1 ONLY: reproduces how the live tracker is open today — the pages talk to the
-- database directly with a public key. Stage 2 removes this file's effect (drop policies,
-- revoke) once the pages go through the backend with a login.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('grant select, insert, update, delete on public.%I to anon', t);
    execute format('drop policy if exists anon_open on public.%I', t);
    execute format('create policy anon_open on public.%I for all to anon using (true) with check (true)', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
