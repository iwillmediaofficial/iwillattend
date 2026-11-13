-- Site work allotment: a manager sends staff to work at an outside site for a date range.
-- On those days office staff can check in from anywhere (the branch geofence is lifted).

create table public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  site_name text not null check (char_length(site_name) between 2 and 120),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'active' check (status in ('active','cancelled')),
  assigned_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (to_date >= from_date)
);
create index site_assignments_org_idx on public.site_assignments(org_id, to_date);
create index site_assignments_emp_idx on public.site_assignments(employee_id, from_date);
create index site_assignments_by_idx on public.site_assignments(assigned_by);
alter table public.site_assignments enable row level security;
create policy site_assignments_select on public.site_assignments for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
revoke all on public.site_assignments from anon;
revoke all on public.site_assignments from authenticated;
grant select on public.site_assignments to authenticated;

-- The site work a check-in was made under (null = normal check-in).
alter table public.attendance add column site_assignment_id uuid references public.site_assignments(id) on delete set null;
create index attendance_site_idx on public.attendance(site_assignment_id) where site_assignment_id is not null;

-- Allot site work to one or more employees. All or nothing.
create function public.assign_site_work(p_employees uuid[], p_from date, p_to date, p_site text, p_details text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_today date;
  v_site text := trim(coalesce(p_site, ''));
  v_id uuid;
  v_emp public.employees;
  v_clash public.site_assignments;
  v_n integer := 0;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select (now() at time zone timezone)::date into v_today from public.organizations where id = v_me.org_id;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_from < v_today then raise exception 'Site work can only be allotted for today or later'; end if;
  if p_to - p_from > 92 then raise exception 'One allotment can cover at most 3 months. Add another for later dates.'; end if;
  if char_length(v_site) < 2 or char_length(v_site) > 120 then raise exception 'Enter the site name (2 to 120 characters)'; end if;
  if p_employees is null or cardinality(p_employees) = 0 then raise exception 'Choose at least one employee'; end if;
  if cardinality(p_employees) > 200 then raise exception 'Choose at most 200 employees at a time'; end if;

  for v_id in select distinct unnest(p_employees) loop
    select * into v_emp from public.employees where id = v_id and org_id = v_me.org_id and is_active;
    if not found then raise exception 'One of the chosen employees is not an active member of this company'; end if;
    select * into v_clash from public.site_assignments s
      where s.employee_id = v_id and s.status = 'active' and s.from_date <= p_to and s.to_date >= p_from
      limit 1;
    if found then
      raise exception '% already has site work (%) from % to %. End that first or choose other dates.',
        v_emp.full_name, v_clash.site_name, to_char(v_clash.from_date, 'DD Mon'), to_char(v_clash.to_date, 'DD Mon');
    end if;
    insert into public.site_assignments(org_id, employee_id, from_date, to_date, site_name, details, assigned_by)
      values (v_me.org_id, v_id, p_from, p_to, v_site, nullif(trim(coalesce(p_details, '')), ''), v_me.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- End site work. Unused: it is cancelled. Already used: it is cut short at the last day worked on site.
create function public.end_site_work(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_row public.site_assignments;
  v_today date;
  v_last date;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into v_row from public.site_assignments where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Site work not found'; end if;
  select (now() at time zone timezone)::date into v_today from public.organizations where id = v_me.org_id;
  if v_row.status <> 'active' or v_row.to_date < v_today then raise exception 'This site work is already over'; end if;
  select max(work_date) into v_last from public.attendance where site_assignment_id = p_id;
  if v_last is null then
    update public.site_assignments set status = 'cancelled', cancelled_at = now() where id = p_id;
  elsif v_last >= v_row.to_date then
    raise exception 'This site work is already complete';
  else
    update public.site_assignments set to_date = v_last, cancelled_at = now() where id = p_id;
  end if;
end $$;

revoke all on function public.assign_site_work(uuid[], date, date, text, text) from public, anon;
revoke all on function public.end_site_work(uuid) from public, anon;
grant execute on function public.assign_site_work(uuid[], date, date, text, text) to authenticated;
grant execute on function public.end_site_work(uuid) to authenticated;

-- Check-in: office staff with approved work from home, or with site work allotted for today, skip the branch geofence.
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
  v_site uuid;
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
  select s.id into v_site from public.site_assignments s
    where s.employee_id = v_emp.id and s.status = 'active' and v_date between s.from_date and s.to_date
    order by s.created_at desc limit 1;
  if v_emp.staff_type = 'office' and v_site is null then
    v_wfh := exists (select 1 from public.wfh_requests w where w.employee_id = v_emp.id and w.status = 'approved'
                      and v_date between w.from_date and w.to_date);
  end if;

  if v_emp.staff_type = 'office' and not v_wfh and v_site is null then
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
      check_in_accuracy_m, check_in_distance_m, check_in_in_geofence, check_in_selfie_path, is_wfh, site_assignment_id)
    values (v_emp.org_id, v_emp.id, v_date, v_branch.id, now(), p_lat, p_lng, p_accuracy, v_dist, v_in, p_selfie_path, v_wfh, v_site)
    returning * into v_row;
  return v_row;
end $$;

-- Attendance checks: the accuracy rule does not apply to a work-from-home or site-work check-in.
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
      if e.staff_type = 'office' and not new.is_wfh and new.site_assignment_id is null
         and (new.check_in_accuracy_m is null or new.check_in_accuracy_m > o.max_accuracy_m) then
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
