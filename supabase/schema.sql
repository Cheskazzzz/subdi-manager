create extension if not exists "pgcrypto";
create type public.user_role as enum ('admin', 'security', 'homeowner');
create type public.resident_status as enum ('pending', 'active', 'inactive');
create type public.pass_status as enum ('pending', 'active', 'expired', 'suspended');
create type public.entry_status as enum ('approved', 'denied');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.user_role not null default 'homeowner',
  first_name text not null,
  last_name text not null,
  created_at timestamptz not null default now()
);
create table public.homeowners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  first_name text not null, last_name text not null, email text not null unique,
  phone text, block text not null, lot text not null,
  status public.resident_status not null default 'pending',
  profile_photo_url text, created_at timestamptz not null default now()
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(), homeowner_id uuid not null references public.homeowners(id) on delete cascade,
  plate_number text not null unique, brand text not null, model text not null, color text not null,
  pass_number text unique, status public.pass_status not null default 'pending', expiration_date date,
  created_at timestamptz not null default now()
);
create table public.announcements (
  id uuid primary key default gen_random_uuid(), title text not null, description text not null,
  status text not null check (status in ('draft','published')) default 'draft', announcement_date date not null default current_date,
  created_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key default gen_random_uuid(), title text not null, description text not null,
  event_date date not null, event_time time not null, location text not null, created_at timestamptz not null default now()
);
create table public.gate_logs (
  id uuid primary key default gen_random_uuid(), homeowner_id uuid references public.homeowners(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null, verification_type text not null default 'Car Pass',
  status public.entry_status not null, verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.biometric_templates (
  id uuid primary key default gen_random_uuid(),
  homeowner_id uuid not null unique references public.homeowners(id) on delete cascade,
  descriptor jsonb not null,
  model_version text not null default 'face-api-1.7',
  consented_at timestamptz not null,
  consent_recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint descriptor_is_array check (jsonb_typeof(descriptor) = 'array')
);

alter table public.profiles enable row level security;
alter table public.homeowners enable row level security;
alter table public.vehicles enable row level security;
alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.gate_logs enable row level security;
alter table public.biometric_templates enable row level security;

create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Published announcements are readable" on public.announcements for select using (status = 'published' or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Events are readable by signed-in users" on public.events for select to authenticated using (true);
create policy "Admins and security can read biometric templates" on public.biometric_templates for select to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'security')));
create policy "Admins can create biometric templates" on public.biometric_templates for insert to authenticated
with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can update biometric templates" on public.biometric_templates for update to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete biometric templates" on public.biometric_templates for delete to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Create the resident profile and pending homeowner application after email/password signup.
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
  -- Link to an existing homeowner record (admin-added or left by a deleted login) instead of failing.
  on conflict (email) do update set user_id = excluded.user_id
  where public.homeowners.user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Security-definer helpers avoid recursive profile-policy checks.
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create policy "Admins can read profiles" on public.profiles for select to authenticated
using (public.current_user_role() = 'admin');
create policy "Users can update own profile" on public.profiles for update to authenticated
using (auth.uid() = id) with check (auth.uid() = id);

create policy "Residents read own homeowner record" on public.homeowners for select to authenticated
using (user_id = auth.uid() or public.current_user_role() in ('admin', 'security'));
create policy "Admins update homeowners" on public.homeowners for update to authenticated
using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Admins create homeowners" on public.homeowners for insert to authenticated
with check (public.current_user_role() = 'admin');
create policy "Admins delete homeowners" on public.homeowners for delete to authenticated
using (public.current_user_role() = 'admin');

-- Delete a resident record and its linked Auth login as one atomic admin action.
-- Gate log history remains, while vehicles and biometric data follow their
-- existing foreign-key deletion rules.
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

create policy "Residents read own vehicles" on public.vehicles for select to authenticated
using (exists (select 1 from public.homeowners h where h.id = homeowner_id and h.user_id = auth.uid()) or public.current_user_role() in ('admin', 'security'));
create policy "Residents request vehicles" on public.vehicles for insert to authenticated
with check (status = 'pending' and exists (select 1 from public.homeowners h where h.id = homeowner_id and h.user_id = auth.uid()));
create policy "Admins manage vehicles" on public.vehicles for all to authenticated
using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

create policy "Authenticated users read announcements" on public.announcements for select to authenticated using (true);
create policy "Admins manage announcements" on public.announcements for all to authenticated
using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Admins manage events" on public.events for all to authenticated
using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

create policy "Staff read gate logs" on public.gate_logs for select to authenticated
using (public.current_user_role() in ('admin', 'security'));
create policy "Staff create gate logs" on public.gate_logs for insert to authenticated
with check (public.current_user_role() in ('admin', 'security'));

-- Users may edit their own name but never their role/email.
revoke update on public.profiles from authenticated, anon;
grant update (first_name, last_name) on public.profiles to authenticated;

-- Keep security-definer helpers off the public API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- Resident self-registration without a confirmation email: admin approval is the gate,
-- so the login is created already confirmed and the homeowner record stays pending.
create or replace function public.register_resident(
  p_email text, p_password text, p_first_name text, p_last_name text,
  p_phone text, p_block text, p_lot text
) returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  new_id uuid := gen_random_uuid();
begin
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
    jsonb_build_object('first_name', trim(p_first_name), 'last_name', trim(p_last_name),
      'phone', trim(p_phone), 'block', trim(p_block), 'lot', trim(p_lot)),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', normalized_email, 'email_verified', true),
    'email', now(), now(), now());
end;
$$;

revoke execute on function public.register_resident(text, text, text, text, text, text, text) from public;
grant execute on function public.register_resident(text, text, text, text, text, text, text) to anon, authenticated;

-- Approving a vehicle (status active) without a real pass number assigns one like IV-2026-0001.
create sequence if not exists public.car_pass_seq;
create or replace function public.assign_car_pass_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(upper(trim(new.pass_number)), '') in ('', 'PENDING') then new.pass_number := null; end if;
  if new.status = 'active' and new.pass_number is null then
    new.pass_number := 'IV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.car_pass_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
create trigger assign_car_pass_number
  before insert or update on public.vehicles
  for each row execute procedure public.assign_car_pass_number();

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

-- Lets the forgot-password form confirm a homeowner account exists before sending a reset link.
create or replace function public.homeowner_account_exists(p_email text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'homeowner' and lower(u.email) = lower(trim(p_email))
  )
$$;
revoke execute on function public.homeowner_account_exists(text) from public;
grant execute on function public.homeowner_account_exists(text) to anon, authenticated;

-- Car passes are valid for 1 year from activation (Philippine time). Renewal = admin sets status back to active,
-- which starts a fresh 1-year period. A nightly job marks lapsed passes as expired.
create or replace function public.set_car_pass_expiration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.expiration_date := ((now() at time zone 'Asia/Manila')::date + interval '1 year')::date;
  end if;
  return new;
end;
$$;
create trigger set_car_pass_expiration
  before insert or update on public.vehicles
  for each row execute procedure public.set_car_pass_expiration();

create or replace function public.expire_car_passes()
returns integer
language sql
security definer set search_path = public
as $$
  with expired as (
    update public.vehicles set status = 'expired'
    where status = 'active' and expiration_date < (now() at time zone 'Asia/Manila')::date
    returning 1
  )
  select count(*)::integer from expired
$$;
revoke execute on function public.expire_car_passes() from public, anon, authenticated;

create extension if not exists pg_cron;
-- Every day at 00:05 Philippine time (16:05 UTC).
select cron.schedule('expire-car-passes', '5 16 * * *', $$select public.expire_car_passes()$$);

-- Input rules shared with lib/validation.ts. Enforced here so bypassing the forms does not bypass them.
create or replace function public.is_valid_person_name(p text)
returns boolean language sql immutable
as $$ select p is not null and length(p) between 1 and 50
  and p ~ '^[A-Za-zÀ-ÖØ-öø-ÿ]+((\. ?|[ ''-])[A-Za-zÀ-ÖØ-öø-ÿ]+)*\.?$'
  and p !~* '(.)\1{3,}' $$;
create or replace function public.is_valid_ph_mobile(p text)
returns boolean language sql immutable
as $$ select p ~ '^(09[0-9]{9}|\+639[0-9]{9})$' $$;
create or replace function public.is_valid_unit(p text)
returns boolean language sql immutable
as $$ select p ~ '^([1-9][0-9]{0,3}[A-Za-z]?|[A-Za-z])$' $$;
create or replace function public.is_valid_email(p text)
returns boolean language sql immutable
as $$ select length(p) <= 254
  and p ~* '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
  and split_part(lower(p), '@', 2) not in ('gmai.com', 'gmial.com', 'gmal.com', 'gamil.com', 'gnail.com', 'gmail.co', 'gmsail.com', 'yaho.com', 'yahooo.com', 'hotmal.com')
  and reverse(split_part(reverse(lower(p)), '.', 1)) not in ('con', 'cmo', 'comm', 'om') $$;

-- New and edited rows must follow the rules; NOT VALID leaves existing rows as they are until edited.
alter table public.homeowners
  add constraint homeowners_first_name_valid check (public.is_valid_person_name(first_name)) not valid,
  add constraint homeowners_last_name_valid check (public.is_valid_person_name(last_name)) not valid,
  add constraint homeowners_email_valid check (public.is_valid_email(email)) not valid,
  add constraint homeowners_phone_valid check (phone is null or public.is_valid_ph_mobile(phone)) not valid,
  add constraint homeowners_block_valid check (public.is_valid_unit(block)) not valid,
  add constraint homeowners_lot_valid check (public.is_valid_unit(lot)) not valid;
alter table public.profiles
  add constraint profiles_first_name_valid check (first_name = '' or public.is_valid_person_name(first_name)) not valid,
  add constraint profiles_last_name_valid check (last_name = '' or public.is_valid_person_name(last_name)) not valid;

-- Only resident registrations (which carry a block) get a homeowner record; staff logins do not.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, first_name, last_name)
  values (new.id, new.email, 'homeowner',
    coalesce(new.raw_user_meta_data->>'first_name', ''), coalesce(new.raw_user_meta_data->>'last_name', ''))
  on conflict (id) do nothing;

  if coalesce(new.raw_user_meta_data->>'block', '') <> '' then
    insert into public.homeowners (user_id, first_name, last_name, email, phone, block, lot, status)
    values (new.id, new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name', new.email,
      new.raw_user_meta_data->>'phone', new.raw_user_meta_data->>'block', new.raw_user_meta_data->>'lot', 'pending')
    -- Link to an existing homeowner record (admin-added or left by a deleted login) instead of failing.
    on conflict (email) do update set user_id = excluded.user_id
    where public.homeowners.user_id is null;
  end if;
  return new;
end;
$$;

-- Resident registration with server-side validation (replaces the earlier version above).
create or replace function public.register_resident(
  p_email text, p_password text, p_first_name text, p_last_name text,
  p_phone text, p_block text, p_lot text
) returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  first_name text := trim(p_first_name);
  last_name text := trim(p_last_name);
  phone text := regexp_replace(coalesce(p_phone, ''), '[[:space:]()-]', '', 'g');
  block text := regexp_replace(trim(p_block), '^(block|blk|lot)\.?[[:space:]]*', '', 'i');
  lot text := regexp_replace(trim(p_lot), '^(block|blk|lot)\.?[[:space:]]*', '', 'i');
  new_id uuid := gen_random_uuid();
begin
  if not public.is_valid_person_name(first_name) then raise exception 'First name can only contain letters, spaces, hyphens, apostrophes and periods (max 50).'; end if;
  if not public.is_valid_person_name(last_name) then raise exception 'Last name can only contain letters, spaces, hyphens, apostrophes and periods (max 50).'; end if;
  if not public.is_valid_email(normalized_email) then raise exception 'Enter a valid email address.'; end if;
  if not public.is_valid_ph_mobile(phone) then raise exception 'Enter a Philippine mobile number, e.g. 09171234567.'; end if;
  if not public.is_valid_unit(block) then raise exception 'Block must be a number such as 23 or 23A.'; end if;
  if not public.is_valid_unit(lot) then raise exception 'Lot must be a number such as 23 or 23A.'; end if;
  if length(coalesce(p_password, '')) not between 8 and 72 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    raise exception 'Password must be 8–72 characters and include at least one letter and one number.';
  end if;
  if exists (select 1 from auth.users where lower(email) = normalized_email) then
    raise exception 'An account with this email already exists.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', normalized_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('first_name', first_name, 'last_name', last_name, 'phone', phone, 'block', block, 'lot', lot),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', normalized_email, 'email_verified', true),
    'email', now(), now(), now());
end;
$$;
