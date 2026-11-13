-- IWILL Attend: overtime. A company-wide rule (multiplier / percentage, or a fixed amount per hour),
-- an optional override per employee, overtime minutes stored at check-out, and manager approval.

alter table public.organizations
  add column ot_enabled boolean not null default false,
  add column ot_mode text not null default 'multiplier' check (ot_mode in ('multiplier','fixed')),
  add column ot_multiplier numeric(4,2) not null default 1.5 check (ot_multiplier between 0.5 and 5),
  add column ot_fixed_rate numeric(10,2) not null default 0 check (ot_fixed_rate >= 0),
  add column ot_min_minutes integer not null default 30 check (ot_min_minutes between 0 and 240),
  add column ot_round_minutes integer not null default 30 check (ot_round_minutes in (1, 15, 30, 60)),
  add column ot_max_minutes integer not null default 240 check (ot_max_minutes between 30 and 960),
  add column ot_requires_approval boolean not null default true,
  add column ot_off_days boolean not null default false;
grant update (ot_enabled, ot_mode, ot_multiplier, ot_fixed_rate, ot_min_minutes, ot_round_minutes, ot_max_minutes, ot_requires_approval, ot_off_days)
  on public.organizations to authenticated;

-- Per employee: follow the company rule, use their own multiplier or fixed rate, or no overtime.
alter table public.salary_structures
  add column ot_mode text not null default 'company' check (ot_mode in ('company','multiplier','fixed','none')),
  add column ot_multiplier numeric(4,2) check (ot_multiplier is null or ot_multiplier between 0.5 and 5),
  add column ot_fixed_rate numeric(10,2) check (ot_fixed_rate is null or ot_fixed_rate >= 0);

alter table public.attendance
  add column ot_minutes integer not null default 0 check (ot_minutes >= 0),
  add column ot_status text check (ot_status in ('pending','approved','rejected','auto'));

alter table public.payslips
  add column ot_hours numeric(6,2) not null default 0,
  add column ot_pay numeric(12,2) not null default 0;

alter table public.muster_snapshots add column ot_minutes integer not null default 0;

-- Same trigger as before, now also working out overtime at check-out.
create or replace function private.attendance_apply_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  o public.organizations;
  v_late numeric;
  v_min integer;
  v_full numeric;
  v_ot integer;
begin
  if tg_op = 'UPDATE' then
    if new.check_in_at is not distinct from old.check_in_at
       and new.check_out_at is not distinct from old.check_out_at
       and new.shift_id is not distinct from old.shift_id then
      return new;
    end if;
  end if;

  select * into o from public.organizations where id = new.org_id;
  if new.shift_id is null then
    select coalesce(e.shift_id,
             (select d.id from public.shifts d where d.org_id = new.org_id and d.is_default and d.is_active limit 1))
      into new.shift_id from public.employees e where e.id = new.employee_id;
  end if;

  new.late_minutes := 0;
  new.status := 'present';
  if new.shift_id is not null then
    select * into s from public.shifts where id = new.shift_id;
    v_late := extract(epoch from (new.check_in_at - ((new.work_date + s.start_time) at time zone o.timezone))) / 60;
    if v_late > s.grace_minutes then
      new.late_minutes := floor(v_late);
      new.status := 'late';
    end if;
  end if;

  new.worked_minutes := null;
  new.day_value := null;
  new.ot_minutes := 0;
  new.ot_status := null;
  if new.check_out_at is not null then
    v_min := greatest(0, floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60))::integer;
    v_full := o.full_day_hours * 60;
    new.worked_minutes := v_min;
    if v_min >= v_full - o.full_day_tolerance_min then
      new.day_value := 1;
    elsif v_min >= o.half_day_hours * 60 then
      if o.between_rule = 'hours' then
        new.day_value := round(v_min / v_full, 3);
        new.status := 'short';
      else
        new.day_value := 0.5;
        new.status := 'half_day';
      end if;
    elsif o.below_half_rule = 'hours' then
      new.day_value := round(v_min / v_full, 3);
      new.status := 'short';
    elsif o.below_half_rule = 'half' then
      new.day_value := 0.5;
      new.status := 'half_day';
    else
      new.day_value := 0;
      new.status := 'short';
    end if;

    if o.ot_enabled then
      -- On a weekly off or holiday every worked hour can count as overtime; otherwise only time beyond a full day.
      if o.ot_off_days and (private.is_off_day(o, new.work_date)
           or exists (select 1 from public.holidays h where h.org_id = o.id and h.holiday_date = new.work_date)) then
        v_ot := v_min;
      else
        v_ot := v_min - v_full::integer;
      end if;
      if v_ot > 0 and v_ot >= o.ot_min_minutes then
        v_ot := least(o.ot_max_minutes, (v_ot / o.ot_round_minutes) * o.ot_round_minutes);
        if v_ot > 0 then
          new.ot_minutes := v_ot;
          new.ot_status := case when o.ot_requires_approval then 'pending' else 'auto' end;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

create function public.decide_overtime(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  a public.attendance;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then raise exception 'Not allowed'; end if;
  select * into a from public.attendance where id = p_id and org_id = v_me.org_id for update;
  if not found then raise exception 'Record not found'; end if;
  if a.ot_minutes = 0 or a.ot_status is null then raise exception 'There is no overtime on this day'; end if;
  if a.ot_status = 'auto' then raise exception 'This overtime does not need approval'; end if;
  if a.employee_id = v_me.id and v_me.role <> 'owner' then raise exception 'You cannot decide your own overtime'; end if;
  if private.month_locked(a.org_id, a.work_date) then
    raise exception 'Payroll for % is finalised. The owner must reopen it before overtime in that month can change.', to_char(a.work_date, 'FMMonth YYYY');
  end if;
  update public.attendance set ot_status = case when p_approve then 'approved' else 'rejected' end where id = p_id;
end $$;
revoke all on function public.decide_overtime(uuid, boolean) from public, anon;
grant execute on function public.decide_overtime(uuid, boolean) to authenticated;
