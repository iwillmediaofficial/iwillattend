-- Flexible weekly offs: besides fixed company days (for example every Sunday), a company or
-- a single employee can have "N days off per week, any day" (a salon closed on no day).
-- Weeks run Monday to Sunday. In a flexible week, days the employee planned as their
-- weekly off count first; any remaining allowance goes to the earliest day they did not
-- come; any further missed days are absent. Staff can plan their off day in the app.

alter table public.organizations
  add column weekly_off_mode text not null default 'fixed' check (weekly_off_mode in ('fixed','flexible')),
  add column flex_offs_per_week smallint not null default 1 check (flex_offs_per_week between 1 and 3);
grant update (weekly_off_mode, flex_offs_per_week) on public.organizations to authenticated;

-- Per employee: null = follow the company; 'fixed' = their own days; 'flexible' = their own allowance.
alter table public.employees
  add column weekly_off_mode text check (weekly_off_mode is null or weekly_off_mode in ('fixed','flexible')),
  add column weekly_offs smallint[] check (weekly_offs is null or weekly_offs <@ array[0,1,2,3,4,5,6]::smallint[]),
  add column flex_offs_per_week smallint check (flex_offs_per_week is null or flex_offs_per_week between 1 and 3);
grant insert (weekly_off_mode, weekly_offs, flex_offs_per_week), update (weekly_off_mode, weekly_offs, flex_offs_per_week) on public.employees to authenticated;

-- The rule that applies to one employee.
create function private.week_rule(p_emp uuid)
returns table (mode text, days smallint[], sats smallint[], per_week smallint)
language sql stable security definer set search_path = '' as $$
  select coalesce(e.weekly_off_mode, o.weekly_off_mode),
         case when e.weekly_off_mode = 'fixed' then coalesce(e.weekly_offs, '{}') else o.weekly_offs end,
         case when e.weekly_off_mode = 'fixed' then '{}'::smallint[] else o.alt_saturday_offs end,
         coalesce(e.flex_offs_per_week, o.flex_offs_per_week)
    from public.employees e join public.organizations o on o.id = e.org_id
   where e.id = p_emp
$$;
revoke all on function private.week_rule(uuid) from public, anon, authenticated;

-- A fixed weekly off for this employee (always false in flexible mode).
create function private.is_fixed_off(p_emp uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.mode = 'fixed'
       and (extract(dow from d)::smallint = any (r.days)
            or (extract(dow from d) = 6 and (((extract(day from d)::int - 1) / 7) + 1)::smallint = any (r.sats)))
      from private.week_rule(p_emp) r), false)
$$;
revoke all on function private.is_fixed_off(uuid, date) from public, anon, authenticated;

-- Leave days charged for a range. Fixed: working days only. Flexible: every non-holiday day,
-- minus the weekly allowance for each full Monday-to-Sunday week inside the range
-- (a 7-day leave is 6 leave days and 1 weekly off).
create function private.leave_days_for(p_emp uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = '' as $$
  with r as (select * from private.week_rule(p_emp)),
  e as (select org_id from public.employees where id = p_emp),
  d as (
    select g::date as day
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
     where not exists (select 1 from public.holidays h, e where h.org_id = e.org_id and h.holiday_date = g::date)
       and not private.is_fixed_off(p_emp, g::date)
  ),
  full_weeks as (
    select date_trunc('week', day)::date as wk, count(*) as n
      from d
     group by 1
    having date_trunc('week', min(day))::date >= p_from and date_trunc('week', min(day))::date + 6 <= p_to
  )
  select (select count(*) from d)::numeric
       - case when (select mode from r) = 'flexible'
              then coalesce((select sum(least(n, (select per_week from r))) from full_weeks), 0)
              else 0 end
$$;
revoke all on function private.leave_days_for(uuid, date, date) from public, anon, authenticated;

-- Worked on a rest day (for "overtime on weekly offs"): a fixed off, or in a flexible week a
-- day beyond the days they are expected to work (7 minus their allowance).
create function private.is_rest_day(p_emp uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when (select mode from private.week_rule(p_emp)) = 'flexible' then
      (select count(distinct a.work_date) from public.attendance a
        where a.employee_id = p_emp and a.work_date <> d
          and a.work_date between date_trunc('week', d)::date and date_trunc('week', d)::date + 6)
      >= 7 - (select per_week from private.week_rule(p_emp))
    else private.is_fixed_off(p_emp, d)
  end
$$;
revoke all on function private.is_rest_day(uuid, date) from public, anon, authenticated;

-- ============ Planned weekly offs ("My weekly off: Thursday") ============
create table public.planned_offs (
  employee_id uuid not null references public.employees(id) on delete cascade,
  off_date date not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  set_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (employee_id, off_date)
);
create index planned_offs_org_idx on public.planned_offs(org_id, off_date);
create index planned_offs_set_by_idx on public.planned_offs(set_by);
alter table public.planned_offs enable row level security;
create policy planned_offs_select on public.planned_offs for select to authenticated
  using (employee_id = (select private.my_employee_id())
         or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
revoke all on public.planned_offs from anon, authenticated;
grant select on public.planned_offs to authenticated;
create trigger planned_offs_no_supervisor before insert on public.planned_offs
  for each row execute function private.block_supervisor_record();

-- Plan or remove a weekly off. Staff plan their own; owners, admins, HR and managers can
-- plan for staff. Only today or later, at most 4 weeks ahead, within the weekly allowance.
create function public.set_planned_off(p_date date, p_on boolean, p_employee uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_emp public.employees;
  v_today date;
  r record;
  v_n integer;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_employee is null or p_employee = v_me.id then
    v_emp := v_me;
  else
    if v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
    select * into v_emp from public.employees where id = p_employee and org_id = v_me.org_id and is_active;
    if not found then raise exception 'Employee not found'; end if;
  end if;
  if v_emp.role in ('owner','admin') then raise exception 'Owners and admins do not have attendance'; end if;
  select * into r from private.week_rule(v_emp.id);
  if r.mode <> 'flexible' then raise exception 'Weekly offs for % are fixed days, so there is nothing to plan', v_emp.full_name; end if;

  select (now() at time zone timezone)::date into v_today from public.organizations where id = v_emp.org_id;
  if p_date is null or p_date < v_today then raise exception 'You can only plan today or a later day'; end if;
  if p_date > v_today + 27 then raise exception 'You can plan up to 4 weeks ahead'; end if;

  if not coalesce(p_on, false) then
    delete from public.planned_offs where employee_id = v_emp.id and off_date = p_date;
    return;
  end if;

  if exists (select 1 from public.planned_offs where employee_id = v_emp.id and off_date = p_date) then return; end if;
  if exists (select 1 from public.attendance a where a.employee_id = v_emp.id and a.work_date = p_date) then
    raise exception '% already checked in on that day', case when v_emp.id = v_me.id then 'You have' else v_emp.full_name || ' has' end;
  end if;
  if exists (select 1 from public.holidays h where h.org_id = v_emp.org_id and h.holiday_date = p_date) then
    raise exception 'That day is a holiday already';
  end if;
  select count(*) into v_n from public.planned_offs
   where employee_id = v_emp.id
     and off_date between date_trunc('week', p_date)::date and date_trunc('week', p_date)::date + 6;
  if v_n >= r.per_week then
    raise exception 'Only % weekly off% can be planned in that week. Remove the other one first.', r.per_week, case when r.per_week = 1 then '' else 's' end;
  end if;
  insert into public.planned_offs(employee_id, off_date, org_id, set_by) values (v_emp.id, p_date, v_emp.org_id, v_me.id);
end $$;
revoke all on function public.set_planned_off(date, boolean, uuid) from public, anon;
grant execute on function public.set_planned_off(date, boolean, uuid) to authenticated;

-- ============ Use the per-employee rules in existing routines ============
-- The bodies are taken from the live functions and only the weekly-off call is swapped,
-- so nothing else in them changes.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.request_leave(uuid,date,date,boolean,text)'::regprocedure);
  n := replace(d, 'private.leave_days(v_org.id, p_from, p_to)', 'private.leave_days_for(v_emp.id, p_from, p_to)');
  if n = d then raise exception 'request_leave: weekly-off call not found'; end if;
  execute n;

  d := pg_get_functiondef('private.release_leave_day(uuid,date)'::regprocedure);
  n := replace(d, 'private.leave_days(l.org_id, ', 'private.leave_days_for(l.employee_id, ');
  if n = d then raise exception 'release_leave_day: weekly-off call not found'; end if;
  execute n;

  d := pg_get_functiondef('private.attendance_apply_shift()'::regprocedure);
  n := replace(d, 'private.is_off_day(o, new.work_date)', 'private.is_rest_day(new.employee_id, new.work_date)');
  if n = d then raise exception 'attendance_apply_shift: weekly-off call not found'; end if;
  execute n;
end $$;
