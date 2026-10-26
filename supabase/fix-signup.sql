-- Fixes "Database error saving new user" on resident registration.
-- Run once in Supabase Dashboard -> SQL Editor.

-- 1. Show homeowner records that block re-registration (no linked login).
select email, first_name, last_name, status, created_at
from public.homeowners where user_id is null order by created_at desc;

-- 2. Make signup link to an existing homeowner record instead of failing on its unique email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, first_name, last_name)
  values (
    new.id,
    new.email,
    'homeowner',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', '')
  )
  on conflict (id) do nothing;

  insert into public.homeowners (user_id, first_name, last_name, email, phone, block, lot, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'block', ''),
    coalesce(new.raw_user_meta_data->>'lot', ''),
    'pending'
  )
  on conflict (email) do update set user_id = excluded.user_id
  where public.homeowners.user_id is null;
  return new;
end;
$$;

-- 3. Any other triggers on auth.users (only on_auth_user_created should be listed).
select t.tgname, p.proname
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
