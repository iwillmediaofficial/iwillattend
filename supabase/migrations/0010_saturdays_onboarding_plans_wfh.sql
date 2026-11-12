-- IWILL Attend: alternate Saturday offs, company details and plan choice at sign-up,
-- plan change requests, and work-from-home requests

-- ============ 1. Alternate Saturdays (for example 2nd and 4th) ============
alter table public.organizations
  add column alt_saturday_offs smallint[] not null default '{}'
  check (alt_saturday_offs <@ array[1,2,3,4,5]::smallint[]);
grant update (alt_saturday_offs) on public.organizations to authenticated;

create function private.is_off_day(o public.organizations, d date) returns boolean
language sql immutable set search_path = '' as $$
  select extract(dow from d)::smallint = any (o.weekly_offs)
      or (extract(dow from d) = 6 and (((extract(day from d)::int - 1) / 7) + 1)::smallint = any (o.alt_saturday_offs))
$$;
revoke all on function private.is_off_day(public.organizations, date) from public, anon, authenticated;

create or replace function private.leave_days(p_org uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = '' as $$
  select count(*)::numeric
    from public.organizations o, generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
   where o.id = p_org
     and not private.is_off_day(o, d::date)
     and not exists (select 1 from public.holidays h where h.org_id = o.id and h.holiday_date = d::date)
$$;

create or replace function public.request_leave(p_leave_type uuid, p_from date, p_to date, p_half_day boolean, p_reason text)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_org public.organizations;
  v_type public.leave_types;
  v_days numeric;
  v_used numeric;
  v_row public.leave_requests;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  select * into v_org from public.organizations where id = v_emp.org_id;
  select * into v_type from public.leave_types where id = p_leave_type and org_id = v_emp.org_id and is_active;
  if not found then raise exception 'Leave type not found'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 60 then raise exception 'A single request can cover at most 60 days'; end if;
  if p_from < (now() at time zone v_org.timezone)::date - 30 then raise exception 'Leave cannot be requested more than 30 days back'; end if;
  if coalesce(p_half_day, false) and p_from <> p_to then raise exception 'A half day must be a single date'; end if;

  v_days := private.leave_days(v_org.id, p_from, p_to);
  if v_days = 0 then raise exception 'There are no working days in that range'; end if;
  if coalesce(p_half_day, false) then v_days := 0.5; end if;

  if exists (select 1 from public.leave_requests r where r.employee_id = v_emp.id
              and r.status in ('pending','approved') and r.from_date <= p_to and r.to_date >= p_from) then
    raise exception 'You already have a leave request covering those dates';
  end if;

  if v_type.is_paid then
    select coalesce(sum(r.days), 0) into v_used from public.leave_requests r
     where r.employee_id = v_emp.id and r.leave_type_id = v_type.id and r.status in ('pending','approved')
       and extract(year from r.from_date) = extract(year from p_from);
    if v_used + v_days > v_type.annual_quota then
      raise exception 'Not enough % balance: % day(s) left this year', v_type.name, v_type.annual_quota - v_used;
    end if;
  end if;

  insert into public.leave_requests(org_id, employee_id, leave_type_id, from_date, to_date, half_day, days, reason)
    values (v_emp.org_id, v_emp.id, v_type.id, p_from, p_to, coalesce(p_half_day, false), v_days,
            nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  return v_row;
end $$;

-- ============ 3. Company details and plan choice at sign-up ============
alter table public.organizations
  add column phone text check (phone is null or char_length(phone) <= 30),
  add column address text check (address is null or char_length(address) <= 300),
  add column city text check (city is null or char_length(city) <= 80),
  add column state text check (state is null or char_length(state) <= 80),
  add column gstin text check (gstin is null or char_length(gstin) <= 20);
grant update (phone, address, city, state, gstin) on public.organizations to authenticated;

drop function public.create_organization(text, text);
create function public.create_organization(p_org_name text, p_full_name text, p_plan text, p_phone text,
    p_address text, p_city text, p_state text, p_gstin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org uuid;
  v_plan text := coalesce(nullif(trim(coalesce(p_plan, '')), ''), 'premium');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.employees where user_id = v_uid) then
    raise exception 'This login already belongs to an organisation';
  end if;
  if not exists (select 1 from public.plans where id = v_plan) then raise exception 'Choose a plan'; end if;
  if nullif(trim(coalesce(p_phone, '')), '') is null then raise exception 'A contact phone number is required'; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;

  -- The Free plan starts straight away. Paid plans start as a 14-day trial of that plan.
  insert into public.organizations(name, created_by, plan_id, sub_status, valid_until, phone, address, city, state, gstin)
    values (trim(p_org_name), v_uid, v_plan,
            case when v_plan = 'free' then 'active' else 'trial' end,
            case when v_plan = 'free' then null else current_date + 14 end,
            trim(p_phone), nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_city, '')), ''),
            nullif(trim(coalesce(p_state, '')), ''), nullif(upper(trim(coalesce(p_gstin, ''))), ''))
    returning id into v_org;
  insert into public.employees(org_id, user_id, full_name, email, phone, role, staff_type)
    values (v_org, v_uid, trim(p_full_name), lower(v_email), trim(p_phone), 'owner', 'field');
  perform private.seed_org_defaults(v_org);
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text, text) to authenticated;

-- ============ 4. Plan change requests (billing is manual, so the platform admin acts on these) ============
create table public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text not null references public.plans(id),
  requested_by uuid references public.employees(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index plan_requests_org_idx on public.plan_requests(org_id, status);
create index plan_requests_plan_idx on public.plan_requests(plan_id);
create index plan_requests_requester_idx on public.plan_requests(requested_by);
alter table public.plan_requests enable row level security;
create policy plan_requests_select on public.plan_requests for select to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
revoke all on public.plan_requests from anon;
grant select on public.plan_requests to authenticated;

create function public.request_plan(p_plan text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin') then raise exception 'Only the owner or an admin can request a plan change'; end if;
  if not exists (select 1 from public.plans where id = p_plan) then raise exception 'Plan not found'; end if;
  update public.plan_requests set status = 'dismissed', closed_at = now() where org_id = v_me.org_id and status = 'pending';
  insert into public.plan_requests(org_id, plan_id, requested_by, note)
    values (v_me.org_id, p_plan, v_me.id, nullif(trim(coalesce(p_note, '')), ''));
end $$;

create function public.admin_list_plan_requests()
returns table (id uuid, org_id uuid, org_name text, org_phone text, current_plan text, plan_id text, note text,
               requester_name text, requester_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
    select r.id, o.id, o.name, o.phone, o.plan_id, r.plan_id, r.note, e.full_name, e.email, r.created_at
      from public.plan_requests r
      join public.organizations o on o.id = r.org_id
      left join public.employees e on e.id = r.requested_by
     where r.status = 'pending'
     order by r.created_at;
end $$;

create function public.admin_close_plan_request(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('done','dismissed') then raise exception 'Invalid status'; end if;
  update public.plan_requests set status = p_status, closed_at = now() where id = p_id;
end $$;

-- Changing a company's plan closes its pending request for that plan.
create or replace function public.admin_update_org(p_org uuid, p_plan text, p_status text, p_valid_until date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  update public.organizations set plan_id = p_plan, sub_status = p_status, valid_until = p_valid_until where id = p_org;
  if not found then raise exception 'Company not found'; end if;
  update public.plan_requests set status = 'done', closed_at = now() where org_id = p_org and status = 'pending' and plan_id = p_plan;
end $$;

create or replace function public.admin_record_payment(p_org uuid, p_plan text, p_amount numeric, p_paid_on date, p_valid_until date, p_reference text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid amount'; end if;
  insert into private.org_payments(org_id, plan_id, amount, paid_on, valid_until, reference, note, recorded_by)
    values (p_org, p_plan, p_amount, coalesce(p_paid_on, current_date), p_valid_until,
            nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()));
  update public.organizations set plan_id = p_plan, sub_status = 'active', valid_until = p_valid_until where id = p_org;
  if not found then raise exception 'Company not found'; end if;
  update public.plan_requests set status = 'done', closed_at = now() where org_id = p_org and status = 'pending' and plan_id = p_plan;
end $$;

revoke all on function public.request_plan(text, text) from public, anon;
revoke all on function public.admin_list_plan_requests() from public, anon;
revoke all on function public.admin_close_plan_request(uuid, text) from public, anon;
grant execute on function public.request_plan(text, text) to authenticated;
grant execute on function public.admin_list_plan_requests() to authenticated;
grant execute on function public.admin_close_plan_request(uuid, text) to authenticated;

-- ============ 5. Work from home ============
create table public.wfh_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index wfh_requests_org_idx on public.wfh_requests(org_id, status);
create index wfh_requests_emp_idx on public.wfh_requests(employee_id, from_date);
create index wfh_requests_decider_idx on public.wfh_requests(decided_by);
alter table public.wfh_requests enable row level security;
create policy wfh_requests_select on public.wfh_requests for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
revoke all on public.wfh_requests from anon;
grant select on public.wfh_requests to authenticated;

alter table public.attendance add column is_wfh boolean not null default false;

create function public.request_wfh(p_from date, p_to date, p_reason text)
returns public.wfh_requests language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_today date;
  v_row public.wfh_requests;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  select (now() at time zone timezone)::date into v_today from public.organizations where id = v_emp.org_id;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_from < v_today then raise exception 'Work from home can only be requested for today or later'; end if;
  if p_to - p_from > 30 then raise exception 'A single request can cover at most 31 days'; end if;
  if exists (select 1 from public.wfh_requests r where r.employee_id = v_emp.id
              and r.status in ('pending','approved') and r.from_date <= p_to and r.to_date >= p_from) then
    raise exception 'You already have a work-from-home request covering those dates';
  end if;
  insert into public.wfh_requests(org_id, employee_id, from_date, to_date, reason)
    values (v_emp.org_id, v_emp.id, p_from, p_to, nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  return v_row;
end $$;

create function public.decide_wfh(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_req public.wfh_requests;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into v_req from public.wfh_requests where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This request was already %', v_req.status; end if;
  if v_req.employee_id = v_me.id and v_me.role <> 'owner' then raise exception 'You cannot decide your own request'; end if;
  update public.wfh_requests set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_me.id, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_id;
end $$;

create or replace function public.cancel_request(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_n integer;
begin
  if v_emp is null then raise exception 'No active employee record for this login'; end if;
  if p_kind = 'leave' then
    update public.leave_requests set status = 'cancelled' where id = p_id and employee_id = v_emp and status = 'pending';
  elsif p_kind = 'correction' then
    update public.correction_requests set status = 'cancelled' where id = p_id and employee_id = v_emp and status = 'pending';
  elsif p_kind = 'wfh' then
    -- Approved work from home can also be withdrawn, as long as it has not been used yet.
    update public.wfh_requests w set status = 'cancelled'
     where w.id = p_id and w.employee_id = v_emp and w.status in ('pending','approved')
       and not exists (select 1 from public.attendance a where a.employee_id = v_emp and a.is_wfh and a.work_date between w.from_date and w.to_date);
  else
    raise exception 'Unknown request type';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'This request can no longer be cancelled'; end if;
end $$;

revoke all on function public.request_wfh(date, date, text) from public, anon;
revoke all on function public.decide_wfh(uuid, boolean, text) from public, anon;
grant execute on function public.request_wfh(date, date, text) to authenticated;
grant execute on function public.decide_wfh(uuid, boolean, text) to authenticated;

-- Check-in: office staff with approved work from home for today skip the branch geofence.
create or replace function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_branch public.branches;
  v_tz text;
  v_date date;
  v_dist double precision;
  v_in boolean;
  v_wfh boolean := false;
  v_row public.attendance;
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

  select timezone into v_tz from public.organizations where id = v_emp.org_id;
  v_date := (now() at time zone v_tz)::date;

  if exists (select 1 from public.attendance where employee_id = v_emp.id and work_date = v_date) then
    raise exception 'You have already checked in today';
  end if;

  if v_emp.branch_id is not null then
    select * into v_branch from public.branches where id = v_emp.branch_id and is_active;
  end if;
  if v_emp.staff_type = 'office' then
    v_wfh := exists (select 1 from public.wfh_requests w where w.employee_id = v_emp.id and w.status = 'approved'
                      and v_date between w.from_date and w.to_date);
  end if;

  if v_emp.staff_type = 'office' and not v_wfh then
    if v_branch.id is null then
      raise exception 'No branch is assigned to you. Ask your admin to assign one.';
    end if;
    v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
    v_in := v_dist <= v_branch.radius_m;
    if not v_in then
      raise exception 'You are % m from %. Check-in is allowed within % m.', round(v_dist), v_branch.name, v_branch.radius_m;
    end if;
  elsif v_branch.id is not null then
    v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
    v_in := v_dist <= v_branch.radius_m;
  end if;

  insert into public.attendance(org_id, employee_id, work_date, branch_id, check_in_at, check_in_lat, check_in_lng,
      check_in_accuracy_m, check_in_distance_m, check_in_in_geofence, check_in_selfie_path, is_wfh)
    values (v_emp.org_id, v_emp.id, v_date, v_branch.id, now(), p_lat, p_lng, p_accuracy, v_dist, v_in, p_selfie_path, v_wfh)
    returning * into v_row;
  return v_row;
end $$;

-- Attendance checks: the accuracy rule does not apply to a work-from-home check-in.
create or replace function private.attendance_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  o public.organizations;
  l record;
  v_times_changed boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_times_changed := new.check_in_at is distinct from old.check_in_at or new.check_out_at is distinct from old.check_out_at;
  end if;
  if v_times_changed and private.month_locked(new.org_id, new.work_date) then
    raise exception 'Payroll for % is finalised. The owner must reopen it before attendance in that month can change.', to_char(new.work_date, 'FMMonth YYYY');
  end if;

  if tg_op = 'INSERT' then
    select * into e from public.employees where id = new.employee_id;
    select * into o from public.organizations where id = new.org_id;
    if new.check_in_selfie_path is not null then
      perform private.assert_fresh_selfie(new.check_in_selfie_path);
      if e.staff_type = 'office' and not new.is_wfh and (new.check_in_accuracy_m is null or new.check_in_accuracy_m > o.max_accuracy_m) then
        raise exception 'Your location is only accurate to about % m, but % m or better is needed. Move near a window or outdoors, wait a few seconds and try again.',
          coalesce(round(new.check_in_accuracy_m)::text, '?'), o.max_accuracy_m;
      end if;
      new.face_required := o.face_check_enabled
        and exists (select 1 from private.face_profiles f where f.employee_id = new.employee_id);
    end if;
    for l in select id from public.leave_requests
              where employee_id = new.employee_id and status in ('pending', 'approved') and not half_day
                and from_date <= new.work_date and to_date >= new.work_date loop
      perform private.release_leave_day(l.id, new.work_date);
    end loop;
  elsif new.check_out_selfie_path is not null and new.check_out_selfie_path is distinct from old.check_out_selfie_path then
    perform private.assert_fresh_selfie(new.check_out_selfie_path);
  end if;
  return new;
end $$;
