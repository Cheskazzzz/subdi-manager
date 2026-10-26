-- Creates a confirmed admin login for the Isabel Village app.
-- Run once in Supabase Dashboard -> SQL Editor.
do $$
declare
  admin_email text := 'admin@isabelvillage.ph';
  admin_password text := 'IsabelVillageAdmin!';
  new_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email = admin_email) then
    -- Account already exists: just reset its password and confirm it.
    update auth.users
       set encrypted_password = extensions.crypt(admin_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where email = admin_email
     returning id into new_id;
  else
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', admin_email,
      extensions.crypt(admin_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"first_name":"Village","last_name":"Admin"}',
      now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_id, new_id::text,
      jsonb_build_object('sub', new_id::text, 'email', admin_email, 'email_verified', true),
      'email', now(), now(), now());
  end if;

  -- Works whether or not the signup trigger exists.
  insert into public.profiles (id, email, role, first_name, last_name)
  values (new_id, admin_email, 'admin', 'Village', 'Admin')
  on conflict (id) do update set role = 'admin';
  delete from public.homeowners where user_id = new_id;
end $$;

select p.email, p.role, u.email_confirmed_at is not null as confirmed
from public.profiles p join auth.users u on u.id = p.id
where p.email = 'admin@isabelvillage.ph';
