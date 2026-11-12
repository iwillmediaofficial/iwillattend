-- Lets the app ask whether the signed-in user is a platform admin, even when
-- that login does not belong to any company.
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin()
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- To make a login a platform admin (run in the Supabase SQL editor):
--   insert into private.platform_admins (user_id) values ('<auth user id>');
