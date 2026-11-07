-- PocketBudget — one-time Supabase setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again; it only creates what is missing.

-- 1. One table holds every synced record (expenses, income, budgets, merchant memory).
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text        not null check (kind in ('expense', 'income', 'budget', 'rule')),
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null,
  deleted    boolean     not null default false,
  server_seq bigint      not null,
  primary key (user_id, kind, id)
);
create sequence if not exists public.records_seq;
create index if not exists records_user_seq on public.records (user_id, server_seq);

-- 2. Security: every user can only ever see and change their own rows.
alter table public.records enable row level security;
drop policy if exists "records: read own"   on public.records;
drop policy if exists "records: insert own" on public.records;
drop policy if exists "records: update own" on public.records;
create policy "records: read own"   on public.records for select to authenticated using (user_id = auth.uid());
create policy "records: insert own" on public.records for insert to authenticated with check (user_id = auth.uid());
create policy "records: update own" on public.records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.records from anon;
grant select, insert, update on public.records to authenticated;
grant usage on sequence public.records_seq to authenticated;

-- 3. Upload changes. The newest edit of a record wins.
create or replace function public.push_records(records jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  for r in select * from jsonb_array_elements(records) loop
    insert into public.records (user_id, kind, id, data, updated_at, deleted, server_seq)
    values (auth.uid(), r->>'kind', r->>'id', r->'data', (r->>'updated_at')::timestamptz,
            coalesce((r->>'deleted')::boolean, false), nextval('public.records_seq'))
    on conflict (user_id, kind, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          server_seq = excluded.server_seq
      where public.records.updated_at <= excluded.updated_at;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- 4. Private storage for receipt photos: each user gets their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "receipts: read own"   on storage.objects;
drop policy if exists "receipts: upload own" on storage.objects;
drop policy if exists "receipts: update own" on storage.objects;
drop policy if exists "receipts: delete own" on storage.objects;
create policy "receipts: read own"   on storage.objects for select to authenticated using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: upload own" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: update own" on storage.objects for update to authenticated using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: delete own" on storage.objects for delete to authenticated using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Done. Next: Authentication → Users → "Add user" (tick "Auto Confirm User"),
-- then Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".
