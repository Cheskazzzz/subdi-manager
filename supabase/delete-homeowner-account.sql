-- Adds complete homeowner-account deletion to an existing installation.
-- Run once in Supabase Dashboard -> SQL Editor.

create or replace function public.delete_homeowner_account(p_homeowner_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete homeowner accounts.';
  end if;

  select user_id into target_user_id
  from public.homeowners
  where id = p_homeowner_id
  for update;

  if not found then
    raise exception 'Homeowner account not found.';
  end if;

  if target_user_id is not null and not exists (
    select 1 from public.profiles where id = target_user_id and role = 'homeowner'
  ) then
    raise exception 'Only homeowner accounts can be deleted here.';
  end if;

  delete from public.homeowners where id = p_homeowner_id;
  if target_user_id is not null then
    delete from auth.users where id = target_user_id;
  end if;
end;
$$;

revoke execute on function public.delete_homeowner_account(uuid) from public, anon;
grant execute on function public.delete_homeowner_account(uuid) to authenticated;
