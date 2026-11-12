-- IWILL Attend: fixes for missed check-outs, pay for off days, leavers, and the plan limit

-- ============ New settings and fields ============
alter table public.organizations
  add column missing_checkout_as text not null default 'half_day' check (missing_checkout_as in ('half_day','full_day','absent')),
  add column sandwich_rule boolean not null default true,
  add column over_limit_since date;
grant update (missing_checkout_as, sandwich_rule) on public.organizations to authenticated;

alter table public.employees add column exit_on date;
grant update (exit_on) on public.employees to authenticated;

alter table public.attendance add column missing_checkout boolean not null default false;

-- A check-out (including one added by an approved correction) clears the flag.
create function private.attendance_clear_missing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.check_out_at is not null then new.missing_checkout := false; end if;
  return new;
end $$;
revoke all on function private.attendance_clear_missing() from public, anon, authenticated;
create trigger attendance_clear_missing before insert or update on public.attendance
for each row execute function private.attendance_clear_missing();

-- ============ Check-out: only a recent open check-in can be closed ============
-- An older open record is a missed check-out and is fixed with a correction request,
-- so it can no longer be closed the next day with an inflated number of hours.
create or replace function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_branch public.branches;
  v_row public.attendance;
  v_dist double precision;
  v_in boolean;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'A valid location is required';
  end if;
  if p_selfie_path is null or p_selfie_path not like v_emp.org_id::text || '/' || v_emp.id::text || '/%' then
    raise exception 'A selfie is required';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'selfies' and o.name = p_selfie_path) then
    raise exception 'Selfie upload not found';
  end if;

  select * into v_row from public.attendance
    where employee_id = v_emp.id and check_out_at is null and not missing_checkout
      and check_in_at > now() - interval '18 hours'
    order by check_in_at desc limit 1;
  if not found then
    raise exception 'No open check-in found. If you missed a check-out, request a correction from History.';
  end if;

  if v_row.branch_id is not null then
    select * into v_branch from public.branches where id = v_row.branch_id;
    if v_branch.id is not null then
      v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
      v_in := v_dist <= v_branch.radius_m;
    end if;
  end if;

  update public.attendance set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_accuracy_m = p_accuracy, check_out_distance_m = v_dist, check_out_in_geofence = v_in,
      check_out_selfie_path = p_selfie_path
    where id = v_row.id returning * into v_row;
  return v_row;
end $$;

-- ============ Effective subscription, now with the over-limit state ============
-- More active employees than the plan allows: 7 days of warning, then attendance pauses
-- until the company upgrades or deactivates staff.
create or replace function private.org_sub(p_org uuid)
returns table (plan_id text, plan_name text, max_employees integer, payroll boolean, face boolean, state text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.max_employees, p.payroll, p.face,
         case when o.sub_status = 'suspended' then 'suspended'
              when o.sub_status = 'active' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'expired'
              when o.over_limit_since is not null
                   and (now() at time zone o.timezone)::date - o.over_limit_since > 7
                   and (select count(*) from public.employees e where e.org_id = o.id and e.is_active) > p.max_employees then 'over_limit'
              else 'ok' end
    from public.organizations o
    join public.plans p on p.id = case
           when o.sub_status = 'trial' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'free'
           else o.plan_id end
   where o.id = p_org
$$;

create or replace function private.enforce_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_org uuid;
  v_count integer;
begin
  if tg_table_name = 'face_profiles' then
    select e.org_id into v_org from public.employees e where e.id = new.employee_id;
  else
    v_org := new.org_id;
  end if;
  select * into s from private.org_sub(v_org);

  if tg_table_name in ('attendance', 'visits') then
    if s.state = 'over_limit' then
      raise exception 'Attendance is paused: your company has more active employees than the % plan allows (%). Ask your admin to upgrade or deactivate staff.', s.plan_name, s.max_employees;
    elsif s.state <> 'ok' then
      raise exception 'Attendance is paused because your company subscription is %. Please ask your admin to renew.', s.state;
    end if;
  elsif tg_table_name = 'employees' then
    -- Only adding a person, or reactivating one, counts against the plan.
    if tg_op = 'UPDATE' then
      if not new.is_active or old.is_active then
        return new;
      end if;
    end if;
    if s.state in ('expired', 'suspended') then
      raise exception 'Employees cannot be added because your company subscription is %.', s.state;
    end if;
    select count(*) into v_count from public.employees where org_id = v_org and is_active and id <> new.id;
    if v_count >= s.max_employees then
      raise exception 'Your % plan allows % active employees. Upgrade your plan to add more.', s.plan_name, s.max_employees;
    end if;
  elsif tg_table_name = 'payroll_runs' then
    if not s.payroll then
      raise exception 'Payroll is not included in your current plan.';
    elsif s.state in ('expired', 'suspended') then
      raise exception 'Payroll is paused because your company subscription is %.', s.state;
    end if;
  elsif tg_table_name = 'face_profiles' then
    if not s.face then
      raise exception 'Face recognition is not included in your current plan.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.my_subscription() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'plan_id', s.plan_id, 'plan_name', s.plan_name, 'max_employees', s.max_employees,
    'payroll', s.payroll, 'face', s.face, 'state', s.state,
    'sub_status', o.sub_status, 'valid_until', o.valid_until, 'over_limit_since', o.over_limit_since,
    'active_employees', (select count(*) from public.employees e where e.org_id = o.id and e.is_active),
    'is_platform_admin', private.is_platform_admin())
  from public.organizations o, private.org_sub(o.id) s
  where o.id = private.my_org_id()
$$;

-- ============ Hourly housekeeping ============
create function private.hourly_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- 1. Flag check-ins that were never checked out.
  update public.attendance set missing_checkout = true
   where check_out_at is null and not missing_checkout and check_in_at < now() - interval '18 hours';

  -- 2. Start, or clear, the over-limit warning period for each company.
  update public.organizations o
     set over_limit_since = case when x.over then (now() at time zone o.timezone)::date else null end
    from (select o2.id,
                 (select count(*) from public.employees e where e.org_id = o2.id and e.is_active) > s.max_employees as over
            from public.organizations o2 cross join lateral private.org_sub(o2.id) s) x
   where x.id = o.id and (o.over_limit_since is null) = x.over;
end $$;
revoke all on function private.hourly_maintenance() from public, anon, authenticated;

select private.hourly_maintenance();
