-- IWILL Attend: company-chosen rules for what a day is worth (Strict, Pay by hours, Lenient, or custom),
-- with each day's result stored when it is decided so later rule changes do not rewrite history.

alter table public.organizations
  add column full_day_hours numeric(4,2) not null default 8 check (full_day_hours between 1 and 24),
  add column half_day_hours numeric(4,2) not null default 4 check (half_day_hours >= 0),
  -- Worked less than the half-day mark: 'absent' = no pay, 'hours' = pay for hours worked, 'half' = half day
  add column below_half_rule text not null default 'absent' check (below_half_rule in ('absent','hours','half')),
  -- Worked between the half-day and full-day marks: 'half' = half day, 'hours' = pay for hours worked
  add column between_rule text not null default 'half' check (between_rule in ('half','hours')),
  -- This many minutes short of a full day still counts as a full day
  add column full_day_tolerance_min integer not null default 0 check (full_day_tolerance_min between 0 and 120),
  add constraint organizations_half_le_full check (half_day_hours <= full_day_hours);
grant update (full_day_hours, half_day_hours, below_half_rule, between_rule, full_day_tolerance_min) on public.organizations to authenticated;

alter table public.attendance
  add column worked_minutes integer,
  add column day_value numeric(4,3) check (day_value is null or day_value between 0 and 1);
alter table public.attendance drop constraint attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('present','late','half_day','short'));

alter table public.muster_snapshots alter column payable type numeric(6,3);

-- Works out shift, lateness, hours worked and the day's value. It runs only when the times
-- change, so a day keeps the result it was given even if the company changes its rules later.
create or replace function private.attendance_apply_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  o public.organizations;
  v_late numeric;
  v_min integer;
  v_full numeric;
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
  end if;
  return new;
end $$;

-- Days recorded before these rules existed keep the value they already had.
update public.attendance
   set worked_minutes = greatest(0, floor(extract(epoch from (check_out_at - check_in_at)) / 60))::integer,
       day_value = case when status = 'half_day' then 0.5 else 1 end
 where check_out_at is not null and day_value is null;
