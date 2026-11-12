-- IWILL Attend: anti-cheating checks, HR limits, and payroll/leave consistency rules

-- ============ New fields ============
alter table public.organizations
  add column max_accuracy_m integer not null default 100 check (max_accuracy_m between 10 and 5000);
grant update (max_accuracy_m) on public.organizations to authenticated;

-- True when the punch came from an employee with a registered face, so an unchecked face is a flag.
alter table public.attendance add column face_required boolean not null default false;
alter table public.visits add column face_required boolean not null default false;

-- A selfie file can back only one punch.
create unique index attendance_in_selfie_uidx on public.attendance(check_in_selfie_path) where check_in_selfie_path is not null;
create unique index attendance_out_selfie_uidx on public.attendance(check_out_selfie_path) where check_out_selfie_path is not null;
create unique index visits_selfie_uidx on public.visits(selfie_path);

-- ============ Helpers ============
create function private.month_locked(p_org uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payroll_runs r
                  where r.org_id = p_org and r.status = 'locked' and r.month = date_trunc('month', p_day)::date)
$$;

create function private.assert_fresh_selfie(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'selfies' and o.name = p_path and o.created_at > now() - interval '5 minutes') then
    raise exception 'That selfie is too old. Please take a new one.';
  end if;
  if exists (select 1 from public.attendance a where a.check_in_selfie_path = p_path or a.check_out_selfie_path = p_path)
     or exists (select 1 from public.visits v where v.selfie_path = p_path) then
    raise exception 'That selfie was already used. Please take a new one.';
  end if;
end $$;

create function private.leave_days(p_org uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = '' as $$
  select count(*)::numeric
    from public.organizations o, generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
   where o.id = p_org
     and not (extract(dow from d)::smallint = any (o.weekly_offs))
     and not exists (select 1 from public.holidays h where h.org_id = o.id and h.holiday_date = d::date)
$$;

-- Takes one day out of a full-day leave request because the employee attended on it.
create function private.release_leave_day(p_id uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.leave_requests;
  v_days numeric;
  v_note text := 'Adjusted automatically: attended on ' || to_char(p_day, 'DD Mon YYYY');
begin
  select * into l from public.leave_requests where id = p_id;
  if l.from_date = l.to_date then
    update public.leave_requests set status = 'cancelled', decision_note = v_note where id = p_id;
    return;
  end if;
  if p_day > l.from_date and p_day < l.to_date then
    -- Attended in the middle: keep the first part here and create the rest as a second request.
    v_days := private.leave_days(l.org_id, p_day + 1, l.to_date);
    if v_days > 0 then
      insert into public.leave_requests(org_id, employee_id, leave_type_id, from_date, to_date, half_day, days, reason, status, decided_by, decided_at, decision_note)
        values (l.org_id, l.employee_id, l.leave_type_id, p_day + 1, l.to_date, false, v_days, l.reason, l.status, l.decided_by, l.decided_at, v_note);
    end if;
    l.to_date := p_day - 1;
  elsif p_day = l.from_date then
    l.from_date := p_day + 1;
  else
    l.to_date := p_day - 1;
  end if;
  v_days := private.leave_days(l.org_id, l.from_date, l.to_date);
  if v_days > 0 then
    update public.leave_requests set from_date = l.from_date, to_date = l.to_date, days = v_days, decision_note = v_note where id = p_id;
  else
    update public.leave_requests set status = 'cancelled', decision_note = v_note where id = p_id;
  end if;
end $$;

revoke all on function private.month_locked(uuid, date) from public, anon, authenticated;
revoke all on function private.assert_fresh_selfie(text) from public, anon, authenticated;
revoke all on function private.leave_days(uuid, date, date) from public, anon, authenticated;
revoke all on function private.release_leave_day(uuid, date) from public, anon, authenticated;

-- ============ Attendance checks ============
create function private.attendance_validate() returns trigger
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
      if e.staff_type = 'office' and (new.check_in_accuracy_m is null or new.check_in_accuracy_m > o.max_accuracy_m) then
        raise exception 'Your location is only accurate to about % m, but % m or better is needed. Move near a window or outdoors, wait a few seconds and try again.',
          coalesce(round(new.check_in_accuracy_m)::text, '?'), o.max_accuracy_m;
      end if;
      new.face_required := o.face_check_enabled
        and exists (select 1 from private.face_profiles f where f.employee_id = new.employee_id);
    end if;
    -- Attending on a day of full-day leave gives that day of leave back.
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
revoke all on function private.attendance_validate() from public, anon, authenticated;
create trigger attendance_validate before insert or update on public.attendance
for each row execute function private.attendance_validate();

create function private.visits_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_fresh_selfie(new.selfie_path);
  new.face_required := (select o.face_check_enabled from public.organizations o where o.id = new.org_id)
    and exists (select 1 from private.face_profiles f where f.employee_id = new.employee_id);
  return new;
end $$;
revoke all on function private.visits_validate() from public, anon, authenticated;
create trigger visits_validate before insert on public.visits
for each row execute function private.visits_validate();

-- ============ Leave checks ============
create function private.leave_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_affects_pay boolean := false;
  v_from date := new.from_date;
  v_to date := new.to_date;
  v_day date;
begin
  if tg_op = 'INSERT' then
    v_affects_pay := new.status = 'approved';
    if new.status = 'pending' and not new.half_day then
      select min(a.work_date) into v_day from public.attendance a
       where a.employee_id = new.employee_id and a.work_date between new.from_date and new.to_date;
      if v_day is not null then
        raise exception 'You already have attendance on %. Choose other dates, or request a half day.', to_char(v_day, 'DD Mon YYYY');
      end if;
    end if;
  else
    v_from := least(new.from_date, old.from_date);
    v_to := greatest(new.to_date, old.to_date);
    v_affects_pay := (new.status is distinct from old.status and 'approved' in (new.status, old.status))
                  or (old.status = 'approved' and (new.from_date <> old.from_date or new.to_date <> old.to_date));
  end if;
  if v_affects_pay and exists (select 1 from public.payroll_runs r
        where r.org_id = new.org_id and r.status = 'locked'
          and r.month between date_trunc('month', v_from)::date and date_trunc('month', v_to)::date) then
    raise exception 'Payroll for that month is finalised. The owner must reopen it before leave in that month can change.';
  end if;
  return new;
end $$;
revoke all on function private.leave_validate() from public, anon, authenticated;
create trigger leave_validate before insert or update on public.leave_requests
for each row execute function private.leave_validate();

-- ============ RPC: cancel or revoke leave ============
create function public.cancel_leave(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  l public.leave_requests;
  v_today date;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  select * into l from public.leave_requests where id = p_id and employee_id = v_emp.id for update;
  if not found then raise exception 'Request not found'; end if;
  select (now() at time zone timezone)::date into v_today from public.organizations where id = v_emp.org_id;
  if l.status = 'approved' and l.from_date <= v_today then
    raise exception 'This leave has already started. Ask your manager to revoke it.';
  elsif l.status not in ('pending', 'approved') then
    raise exception 'This request is already %', l.status;
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
end $$;

create function public.revoke_leave(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  l public.leave_requests;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into l from public.leave_requests where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Request not found'; end if;
  if l.status <> 'approved' then raise exception 'Only approved leave can be revoked'; end if;
  if l.employee_id = v_me.id and v_me.role <> 'owner' then raise exception 'You cannot revoke your own leave'; end if;
  update public.leave_requests set status = 'cancelled', decided_by = v_me.id, decided_at = now(),
      decision_note = 'Revoked' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '')
    where id = p_id;
end $$;

revoke all on function public.cancel_leave(uuid) from public, anon;
revoke all on function public.revoke_leave(uuid, text) from public, anon;
grant execute on function public.cancel_leave(uuid) to authenticated;
grant execute on function public.revoke_leave(uuid, text) to authenticated;

-- ============ Payroll guards ============
create function private.payroll_run_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
begin
  if new.status = 'locked' and old.status <> 'locked' then
    select (now() at time zone timezone)::date into v_today from public.organizations where id = new.org_id;
    if v_today <= (new.month + interval '1 month' - interval '1 day')::date then
      raise exception 'Payroll for % cannot be finalised until the month has ended.', to_char(new.month, 'FMMonth YYYY');
    end if;
    if exists (select 1 from public.payslips p where p.run_id = new.id and p.net_pay < 0) then
      raise exception 'One or more payslips have a negative net pay. Adjust them before finalising.';
    end if;
  elsif old.status = 'locked' and new.status <> 'locked' then
    if (select auth.uid()) is not null and private.my_role() <> 'owner' then
      raise exception 'Only the owner can reopen a finalised payroll.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.payroll_run_guard() from public, anon, authenticated;
create trigger payroll_run_guard before update on public.payroll_runs
for each row execute function private.payroll_run_guard();

-- HR runs payroll for everyone else, but cannot set their own pay.
create function private.hr_own_pay_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and private.my_role() = 'hr' and new.employee_id = private.my_employee_id() then
    raise exception 'HR cannot change their own salary or payslip. Ask an admin or the owner.';
  end if;
  return new;
end $$;
revoke all on function private.hr_own_pay_guard() from public, anon, authenticated;
create trigger salary_structures_hr_guard before insert or update on public.salary_structures
for each row execute function private.hr_own_pay_guard();
create trigger payslips_hr_guard before update on public.payslips
for each row execute function private.hr_own_pay_guard();

-- ============ HR cannot edit admins or the owner ============
create or replace function private.guard_employee_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  caller_role public.app_role;
  caller_emp uuid;
begin
  if (select auth.uid()) is null then
    return new; -- service role / server side
  end if;
  caller_role := private.my_role();
  caller_emp := private.my_employee_id();

  if new.org_id <> old.org_id or new.user_id is distinct from old.user_id or new.email <> old.email then
    raise exception 'Organisation, login and email cannot be changed here';
  end if;
  if old.role = 'owner' and caller_role <> 'owner' then
    raise exception 'Only the owner can edit the owner record';
  end if;
  if caller_role = 'hr' and old.role = 'admin' and old.id <> caller_emp then
    raise exception 'HR cannot edit an admin. Ask the owner or another admin.';
  end if;
  if new.role <> old.role then
    if old.id = caller_emp then
      raise exception 'You cannot change your own role';
    end if;
    if caller_role not in ('owner','admin') then
      raise exception 'Only an owner or admin can change roles';
    end if;
    if new.role = 'owner' or old.role = 'owner' then
      raise exception 'The owner role cannot be reassigned';
    end if;
  end if;
  if old.id = caller_emp and new.is_active = false then
    raise exception 'You cannot deactivate yourself';
  end if;
  return new;
end $$;

-- ============ Frozen attendance sheet, saved when a month is finalised ============
create table public.muster_snapshots (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  full_name text not null,
  emp_code text,
  days text[] not null,
  counts jsonb not null,
  unpaid_off numeric(5,1) not null default 0,
  payable numeric(5,1) not null default 0,
  primary key (org_id, month, employee_id)
);
create index muster_snapshots_employee_idx on public.muster_snapshots(employee_id);
alter table public.muster_snapshots enable row level security;
create policy muster_snapshots_select on public.muster_snapshots for select to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy muster_snapshots_insert on public.muster_snapshots for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()) and not private.month_locked(org_id, month));
create policy muster_snapshots_delete on public.muster_snapshots for delete to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()) and not private.month_locked(org_id, month));
revoke all on public.muster_snapshots from anon;
grant select, insert, delete on public.muster_snapshots to authenticated;
grant execute on function private.month_locked(uuid, date) to authenticated;
