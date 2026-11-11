-- IWILL Attend phase 4: shifts, weekly offs, holidays, leave, attendance corrections

-- ============ Shifts ============
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  half_day_under_hours numeric(4,2) not null default 4 check (half_day_under_hours between 0 and 24),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index shifts_org_idx on public.shifts(org_id);
create unique index shifts_one_default_uidx on public.shifts(org_id) where is_default;

alter table public.employees
  add column shift_id uuid references public.shifts(id) on delete set null,
  add column joined_on date not null default current_date;
update public.employees set joined_on = (created_at at time zone 'Asia/Kolkata')::date;
create index employees_shift_idx on public.employees(shift_id);

-- 0 = Sunday ... 6 = Saturday
alter table public.organizations
  add column weekly_offs smallint[] not null default '{0}'
  check (weekly_offs <@ array[0,1,2,3,4,5,6]::smallint[]);

-- ============ Holidays ============
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null check (char_length(name) between 1 and 120),
  unique (org_id, holiday_date)
);

-- ============ Leave ============
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  annual_quota numeric(5,1) not null default 0 check (annual_quota between 0 and 366),
  is_paid boolean not null default true,
  is_active boolean not null default true,
  unique (org_id, name)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  from_date date not null,
  to_date date not null,
  half_day boolean not null default false,
  days numeric(5,1) not null check (days > 0),
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index leave_requests_org_idx on public.leave_requests(org_id, status);
create index leave_requests_emp_idx on public.leave_requests(employee_id, from_date);
create index leave_requests_type_idx on public.leave_requests(leave_type_id);
create index leave_requests_decider_idx on public.leave_requests(decided_by);

-- ============ Attendance corrections ============
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  check (requested_check_in is not null or requested_check_out is not null)
);
create index correction_requests_org_idx on public.correction_requests(org_id, status);
create index correction_requests_emp_idx on public.correction_requests(employee_id, work_date);
create index correction_requests_decider_idx on public.correction_requests(decided_by);

-- ============ Attendance: shift status, and rows created by a correction ============
alter table public.attendance
  alter column check_in_lat drop not null,
  alter column check_in_lng drop not null,
  alter column check_in_selfie_path drop not null,
  add column shift_id uuid references public.shifts(id) on delete set null,
  add column late_minutes integer not null default 0,
  add column status text not null default 'present' check (status in ('present','late','half_day')),
  add column is_corrected boolean not null default false;
create index attendance_shift_idx on public.attendance(shift_id);

-- Works out the shift, late minutes and status every time a row is written.
create function private.attendance_apply_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  v_tz text;
  v_late numeric;
begin
  if new.shift_id is null then
    select coalesce(e.shift_id,
             (select d.id from public.shifts d where d.org_id = new.org_id and d.is_default and d.is_active limit 1))
      into new.shift_id from public.employees e where e.id = new.employee_id;
  end if;
  new.late_minutes := 0;
  new.status := 'present';
  if new.shift_id is not null then
    select * into s from public.shifts where id = new.shift_id;
    select timezone into v_tz from public.organizations where id = new.org_id;
    v_late := extract(epoch from (new.check_in_at - ((new.work_date + s.start_time) at time zone v_tz))) / 60;
    if v_late > s.grace_minutes then
      new.late_minutes := floor(v_late);
      new.status := 'late';
    end if;
    if new.check_out_at is not null
       and extract(epoch from (new.check_out_at - new.check_in_at)) / 3600 < s.half_day_under_hours then
      new.status := 'half_day';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.attendance_apply_shift() from public, anon;

create trigger attendance_apply_shift before insert or update on public.attendance
for each row execute function private.attendance_apply_shift();

-- ============ Row Level Security ============
alter table public.shifts enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.correction_requests enable row level security;

create policy shifts_select on public.shifts for select to authenticated
  using (org_id = (select private.my_org_id()));
create policy shifts_insert on public.shifts for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy shifts_update on public.shifts for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy holidays_select on public.holidays for select to authenticated
  using (org_id = (select private.my_org_id()));
create policy holidays_insert on public.holidays for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy holidays_delete on public.holidays for delete to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()));

create policy leave_types_select on public.leave_types for select to authenticated
  using (org_id = (select private.my_org_id()));
create policy leave_types_insert on public.leave_types for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy leave_types_update on public.leave_types for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy leave_requests_select on public.leave_requests for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));

create policy correction_requests_select on public.correction_requests for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));

revoke all on public.shifts, public.holidays, public.leave_types, public.leave_requests, public.correction_requests from anon;
grant select on public.shifts, public.holidays, public.leave_types, public.leave_requests, public.correction_requests to authenticated;
grant insert, update on public.shifts, public.leave_types to authenticated;
grant insert, delete on public.holidays to authenticated;
grant update (weekly_offs) on public.organizations to authenticated;
grant update (shift_id, joined_on) on public.employees to authenticated;

-- ============ Defaults for every organisation ============
create function private.seed_org_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.shifts where org_id = p_org) then
    insert into public.shifts(org_id, name, start_time, end_time, grace_minutes, half_day_under_hours, is_default)
      values (p_org, 'General', '09:30', '18:30', 10, 4, true);
  end if;
  insert into public.leave_types(org_id, name, annual_quota, is_paid) values
    (p_org, 'Casual Leave', 12, true),
    (p_org, 'Sick Leave', 12, true),
    (p_org, 'Earned Leave', 15, true),
    (p_org, 'Loss of Pay', 0, false)
  on conflict (org_id, name) do nothing;
end $$;
revoke all on function private.seed_org_defaults(uuid) from public, anon, authenticated;

select private.seed_org_defaults(id) from public.organizations;

create or replace function public.create_organization(p_org_name text, p_full_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.employees where user_id = v_uid) then
    raise exception 'This login already belongs to an organisation';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  insert into public.organizations(name, created_by) values (trim(p_org_name), v_uid) returning id into v_org;
  insert into public.employees(org_id, user_id, full_name, email, role, staff_type)
    values (v_org, v_uid, trim(p_full_name), lower(v_email), 'owner', 'field');
  perform private.seed_org_defaults(v_org);
  return v_org;
end $$;

-- ============ RPC: leave ============
create function public.request_leave(p_leave_type uuid, p_from date, p_to date, p_half_day boolean, p_reason text)
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

  select count(*) into v_days from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
   where not (extract(dow from d)::smallint = any (v_org.weekly_offs))
     and not exists (select 1 from public.holidays h where h.org_id = v_org.id and h.holiday_date = d::date);
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

create function public.cancel_request(p_kind text, p_id uuid)
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
  else
    raise exception 'Unknown request type';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Only your own pending requests can be cancelled'; end if;
end $$;

create function public.decide_leave(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_req public.leave_requests;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into v_req from public.leave_requests where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This request was already %', v_req.status; end if;
  if v_req.employee_id = v_me.id and v_me.role <> 'owner' then raise exception 'You cannot decide your own request'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_me.id, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_id;
end $$;

-- ============ RPC: attendance corrections ============
create function public.request_correction(p_date date, p_in time, p_out time, p_reason text)
returns public.correction_requests language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_tz text;
  v_today date;
  v_in timestamptz;
  v_out timestamptz;
  v_row public.correction_requests;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  select timezone into v_tz from public.organizations where id = v_emp.org_id;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date > v_today or p_date < v_today - 31 then
    raise exception 'Choose a date within the last 31 days';
  end if;
  if p_in is null and p_out is null then raise exception 'Enter a check-in time, a check-out time, or both'; end if;
  if p_in is not null then v_in := (p_date + p_in) at time zone v_tz; end if;
  if p_out is not null then v_out := (p_date + p_out) at time zone v_tz; end if;
  if v_in is not null and v_out is not null and v_out <= v_in then raise exception 'Check-out must be after check-in'; end if;
  if coalesce(v_in, v_out) > now() or coalesce(v_out, v_in) > now() then raise exception 'Times cannot be in the future'; end if;
  if v_in is null and not exists (select 1 from public.attendance where employee_id = v_emp.id and work_date = p_date) then
    raise exception 'There is no check-in on that date, so enter the check-in time too';
  end if;
  if exists (select 1 from public.correction_requests where employee_id = v_emp.id and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for that date';
  end if;
  insert into public.correction_requests(org_id, employee_id, work_date, requested_check_in, requested_check_out, reason)
    values (v_emp.org_id, v_emp.id, p_date, v_in, v_out, trim(p_reason))
    returning * into v_row;
  return v_row;
end $$;

create function public.decide_correction(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_req public.correction_requests;
  v_att public.attendance;
  v_in timestamptz;
  v_out timestamptz;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into v_req from public.correction_requests where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This request was already %', v_req.status; end if;
  if v_req.employee_id = v_me.id and v_me.role <> 'owner' then raise exception 'You cannot decide your own request'; end if;

  if p_approve then
    select * into v_att from public.attendance where employee_id = v_req.employee_id and work_date = v_req.work_date;
    if found then
      v_in := coalesce(v_req.requested_check_in, v_att.check_in_at);
      v_out := coalesce(v_req.requested_check_out, v_att.check_out_at);
      if v_out is not null and v_out <= v_in then raise exception 'Check-out would be before check-in. Reject this and ask for a new request.'; end if;
      update public.attendance set check_in_at = v_in, check_out_at = v_out, is_corrected = true where id = v_att.id;
    else
      if v_req.requested_check_in is null then raise exception 'No check-in exists for that date. Reject this and ask for a new request.'; end if;
      insert into public.attendance(org_id, employee_id, work_date, branch_id, check_in_at, check_out_at, is_corrected)
        select v_req.org_id, e.id, v_req.work_date, e.branch_id, v_req.requested_check_in, v_req.requested_check_out, true
          from public.employees e where e.id = v_req.employee_id;
    end if;
  end if;

  update public.correction_requests set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_me.id, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_id;
end $$;

revoke all on function public.request_leave(uuid, date, date, boolean, text) from public, anon;
revoke all on function public.cancel_request(text, uuid) from public, anon;
revoke all on function public.decide_leave(uuid, boolean, text) from public, anon;
revoke all on function public.request_correction(date, time, time, text) from public, anon;
revoke all on function public.decide_correction(uuid, boolean, text) from public, anon;
grant execute on function public.request_leave(uuid, date, date, boolean, text) to authenticated;
grant execute on function public.cancel_request(text, uuid) to authenticated;
grant execute on function public.decide_leave(uuid, boolean, text) to authenticated;
grant execute on function public.request_correction(date, time, time, text) to authenticated;
grant execute on function public.decide_correction(uuid, boolean, text) to authenticated;
