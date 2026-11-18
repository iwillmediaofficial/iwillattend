-- Forgot password by email code (OTP). The password-reset Edge Function makes the
-- 6-digit code, sends it through Resend, and keeps only a keyed hash of it here.
-- These functions are callable only by the service role (the Edge Function).

create table private.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- Null when no active login has this email: the request is still recorded so the
  -- limits behave the same and nobody can tell which emails are registered.
  user_id uuid references auth.users(id) on delete cascade,
  code_hash text,
  ip text,
  attempts integer not null default 0,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_reset_codes_email_idx on private.password_reset_codes(email, created_at desc);
create index password_reset_codes_ip_idx on private.password_reset_codes(ip, created_at desc);
create index password_reset_codes_user_idx on private.password_reset_codes(user_id);
alter table private.password_reset_codes enable row level security;
revoke all on private.password_reset_codes from public, anon, authenticated;

-- Records a request. Returns status: sent (send the email), unknown (do not send),
-- wait (asked again within 60 s) or limit (too many in the last hour).
create function public.pw_reset_issue(p_email text, p_ip text, p_code_hash text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_last timestamptz;
  v_user uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    return json_build_object('status', 'invalid');
  end if;
  select max(created_at) into v_last from private.password_reset_codes where email = v_email;
  if v_last > now() - interval '60 seconds' then
    return json_build_object('status', 'wait', 'wait_seconds', ceil(extract(epoch from v_last + interval '60 seconds' - now())));
  end if;
  if (select count(*) from private.password_reset_codes where email = v_email and created_at > now() - interval '1 hour') >= 5
     or (p_ip is not null and (select count(*) from private.password_reset_codes where ip = p_ip and created_at > now() - interval '1 hour') >= 20) then
    return json_build_object('status', 'limit');
  end if;

  select e.user_id into v_user from public.employees e
   where lower(e.email) = v_email and e.is_active and e.user_id is not null
   limit 1;

  -- A new code cancels any earlier one for this email.
  update private.password_reset_codes set used_at = now() where email = v_email and used_at is null;
  insert into private.password_reset_codes(email, user_id, code_hash, ip)
    values (v_email, v_user, case when v_user is null then null else p_code_hash end, p_ip);
  -- Old rows are not needed after a day.
  delete from private.password_reset_codes where created_at < now() - interval '1 day';
  return json_build_object('status', case when v_user is null then 'unknown' else 'sent' end);
end $$;

-- Checks a code without using it up. Status: ok (with id and user_id), wrong (with tries_left),
-- locked (5 wrong tries) or expired (no valid code).
create function public.pw_reset_check(p_email text, p_code_hash text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  r private.password_reset_codes;
begin
  select * into r from private.password_reset_codes
   where email = v_email and used_at is null and user_id is not null and expires_at > now()
   order by created_at desc limit 1
   for update;
  if not found then return json_build_object('status', 'expired'); end if;
  if not exists (select 1 from public.employees e where e.user_id = r.user_id and e.is_active) then
    update private.password_reset_codes set used_at = now() where id = r.id;
    return json_build_object('status', 'expired');
  end if;
  if r.code_hash is distinct from p_code_hash then
    update private.password_reset_codes set attempts = attempts + 1,
           used_at = case when attempts + 1 >= 5 then now() else null end
     where id = r.id;
    if r.attempts + 1 >= 5 then return json_build_object('status', 'locked'); end if;
    return json_build_object('status', 'wrong', 'tries_left', 5 - (r.attempts + 1));
  end if;
  return json_build_object('status', 'ok', 'id', r.id, 'user_id', r.user_id);
end $$;

-- Marks a code used once the new password is saved.
create function public.pw_reset_consume(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.password_reset_codes set used_at = now() where id = p_id and used_at is null;
$$;

revoke all on function public.pw_reset_issue(text, text, text) from public, anon, authenticated;
revoke all on function public.pw_reset_check(text, text) from public, anon, authenticated;
revoke all on function public.pw_reset_consume(uuid) from public, anon, authenticated;
grant execute on function public.pw_reset_issue(text, text, text) to service_role;
grant execute on function public.pw_reset_check(text, text) to service_role;
grant execute on function public.pw_reset_consume(uuid) to service_role;
