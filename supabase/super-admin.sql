-- Super admin + staff accounts.
-- Run once in Supabase Dashboard -> SQL Editor. Safe to run again.
--
-- A super admin is an admin who also creates and manages the other staff (admin/security) accounts.
-- New staff get a default password from the super admin and must replace it on first login.
-- Column-level grants already stop users from editing these flags on their own profile.

alter table public.profiles add column if not exists is_super_admin boolean not null default false;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
update public.profiles set is_super_admin = true where email = 'admin@isabelvillage.ph' and role = 'admin';

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select is_super_admin and role = 'admin' from public.profiles where id = auth.uid()), false) $$;

-- Raises unless the caller is a super admin and the target is a regular (non-super) staff account.
create or replace function public.assert_manageable_staff(p_user_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only the super admin can manage staff accounts.'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role in ('admin', 'security') and not is_super_admin) then
    raise exception 'That account is not a staff account that can be changed.';
  end if;
end;
$$;

create or replace function public.create_staff_account(
  p_email text, p_password text, p_first_name text, p_last_name text, p_role public.user_role
) returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  new_id uuid := gen_random_uuid();
begin
  if not public.is_super_admin() then raise exception 'Only the super admin can manage staff accounts.'; end if;
  if p_role not in ('admin', 'security') then raise exception 'Staff accounts must be admin or security.'; end if;
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must contain at least 8 characters.'; end if;
  if exists (select 1 from auth.users where lower(email) = normalized_email) then
    raise exception 'An account with this email already exists.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', normalized_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('first_name', trim(p_first_name), 'last_name', trim(p_last_name)),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', normalized_email, 'email_verified', true),
    'email', now(), now(), now());

  -- The signup trigger treats every new login as a resident; convert it to a staff account.
  update public.profiles set role = p_role, must_change_password = true where id = new_id;
  delete from public.homeowners where user_id = new_id and created_at = now();
  update public.homeowners set user_id = null where user_id = new_id;
  return new_id;
end;
$$;

create or replace function public.update_staff_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_manageable_staff(p_user_id);
  if p_role not in ('admin', 'security') then raise exception 'Staff accounts must be admin or security.'; end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

create or replace function public.reset_staff_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public.assert_manageable_staff(p_user_id);
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must contain at least 8 characters.'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user_id;
  update public.profiles set must_change_password = true where id = p_user_id;
end;
$$;

create or replace function public.delete_staff_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_manageable_staff(p_user_id);
  delete from auth.users where id = p_user_id;
end;
$$;

-- Called by a staff member right after replacing their default password.
create or replace function public.clear_must_change_password()
returns void
language sql security definer set search_path = public
as $$ update public.profiles set must_change_password = false where id = auth.uid() $$;

revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.assert_manageable_staff(uuid) from public, anon, authenticated;
revoke execute on function public.create_staff_account(text, text, text, text, public.user_role) from public, anon;
revoke execute on function public.update_staff_role(uuid, public.user_role) from public, anon;
revoke execute on function public.reset_staff_password(uuid, text) from public, anon;
revoke execute on function public.delete_staff_account(uuid) from public, anon;
revoke execute on function public.clear_must_change_password() from public, anon;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.create_staff_account(text, text, text, text, public.user_role) to authenticated;
grant execute on function public.update_staff_role(uuid, public.user_role) to authenticated;
grant execute on function public.reset_staff_password(uuid, text) to authenticated;
grant execute on function public.delete_staff_account(uuid) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;

-- Should show admin@isabelvillage.ph with is_super_admin = true.
select email, role, is_super_admin from public.profiles where role in ('admin', 'security') order by is_super_admin desc, email;
