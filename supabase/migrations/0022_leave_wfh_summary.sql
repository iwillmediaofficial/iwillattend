-- Per-employee leave and WFH totals for a date range, worked out in the database so the
-- History page receives one small row per employee instead of every request.

create function public.leave_wfh_summary(p_from date, p_to date, p_employee uuid default null)
returns table (
  employee_id uuid,
  full_name text,
  emp_code text,
  leave_days numeric,         -- approved leave days inside the range (all types)
  unpaid_days numeric,        -- of which unpaid
  by_type jsonb,              -- [{ "type": "Casual Leave", "days": 2, "quota": 12, "left": 9 }]
  wfh_days integer,           -- days actually worked from home (checked in on approved WFH)
  pending_requests integer    -- leave and WFH requests still waiting, overlapping the range
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.my_org_id();
  v_year int := extract(year from p_to)::int;
begin
  if v_org is null or not private.is_org_manager() then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 366 then raise exception 'Choose a range of one year or less'; end if;

  return query
  with staff as (
    select e.id, e.full_name, e.emp_code
      from public.employees e
     where e.org_id = v_org and e.role not in ('owner','admin')
       and (p_employee is null or e.id = p_employee)
       and (e.is_active or e.exit_on >= p_from)
  ),
  -- Approved leave, counted only for the part of each request inside the range.
  lv as (
    select r.employee_id, t.name as type_name, t.is_paid, t.annual_quota,
           case when r.half_day then 0.5
                else private.leave_days_for(r.employee_id, greatest(r.from_date, p_from), least(r.to_date, p_to)) end as days
      from public.leave_requests r
      join public.leave_types t on t.id = r.leave_type_id
      join staff s on s.id = r.employee_id
     where r.status = 'approved' and r.from_date <= p_to and r.to_date >= p_from
  ),
  -- Paid leave used in the whole calendar year of the range end, for "days left".
  used_year as (
    select r.employee_id, r.leave_type_id, sum(r.days) as used
      from public.leave_requests r
      join staff s on s.id = r.employee_id
     where r.status in ('pending','approved') and extract(year from r.from_date)::int = v_year
     group by 1, 2
  ),
  types as (
    select s.id as employee_id,
           jsonb_agg(jsonb_build_object(
             'type', t.name,
             'paid', t.is_paid,
             'days', coalesce((select sum(l.days) from lv l where l.employee_id = s.id and l.type_name = t.name), 0),
             'quota', case when t.is_paid then t.annual_quota end,
             'left', case when t.is_paid then t.annual_quota - coalesce(u.used, 0) end
           ) order by t.name) as by_type
      from staff s
      cross join public.leave_types t
      left join used_year u on u.employee_id = s.id and u.leave_type_id = t.id
     where t.org_id = v_org and (t.is_active or exists (select 1 from lv l where l.employee_id = s.id and l.type_name = t.name))
     group by s.id
  )
  select s.id, s.full_name, s.emp_code,
         coalesce((select sum(l.days) from lv l where l.employee_id = s.id), 0),
         coalesce((select sum(l.days) from lv l where l.employee_id = s.id and not l.is_paid), 0),
         coalesce(ty.by_type, '[]'::jsonb),
         (select count(*)::int from public.attendance a where a.employee_id = s.id and a.is_wfh and a.work_date between p_from and p_to),
         ((select count(*) from public.leave_requests r where r.employee_id = s.id and r.status = 'pending' and r.from_date <= p_to and r.to_date >= p_from)
          + (select count(*) from public.wfh_requests w where w.employee_id = s.id and w.status = 'pending' and w.from_date <= p_to and w.to_date >= p_from))::int
    from staff s
    left join types ty on ty.employee_id = s.id
   order by s.full_name;
end $$;

revoke all on function public.leave_wfh_summary(date, date, uuid) from public, anon;
grant execute on function public.leave_wfh_summary(date, date, uuid) to authenticated;

-- The history list filters requests by employee and date; these keep those lookups quick.
create index if not exists leave_requests_org_from_idx on public.leave_requests(org_id, from_date);
create index if not exists wfh_requests_org_from_idx on public.wfh_requests(org_id, from_date);
create index if not exists attendance_wfh_idx on public.attendance(employee_id, work_date) where is_wfh;
