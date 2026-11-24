-- Monthly leave allowances: a paid leave type can give N days per month (for example
-- 2 per month) instead of N per year, optionally carrying unused days over to later months
-- of the same year. Balances are checked month by month; weekly offs and holidays inside a
-- leave are not charged.

alter table public.leave_types
  add column allowance_period text not null default 'year' check (allowance_period in ('year','month')),
  add column monthly_quota numeric not null default 0 check (monthly_quota >= 0 and monthly_quota <= 31),
  add column carry_forward boolean not null default false;

-- Days of one employee's leave of one type that fall inside one calendar month.
create function private.leave_used_in_month(p_emp uuid, p_type uuid, p_month date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(
           case when r.half_day then 0.5
                else private.leave_days_for(p_emp, greatest(r.from_date, p_month), least(r.to_date, (p_month + interval '1 month - 1 day')::date)) end
         ), 0)
    from public.leave_requests r
   where r.employee_id = p_emp and r.leave_type_id = p_type and r.status in ('pending','approved')
     and r.from_date <= (p_month + interval '1 month - 1 day')::date and r.to_date >= p_month
$$;
revoke all on function private.leave_used_in_month(uuid, uuid, date) from public, anon, authenticated;

-- First month of the year this person earns monthly leave (January, or their joining month).
create function private.leave_start_month(p_emp uuid, p_year int) returns date
language sql stable security definer set search_path = '' as $$
  select greatest(make_date(p_year, 1, 1), date_trunc('month', e.joined_on)::date)
    from public.employees e where e.id = p_emp
$$;
revoke all on function private.leave_start_month(uuid, int) from public, anon, authenticated;

-- Balance left for one type as of a date: yearly types for the year, monthly types for that
-- month (with carry-over, everything earned so far this year minus everything used so far).
create function private.leave_left(p_emp uuid, p_type uuid, p_as_of date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.leave_types;
  v_month date := date_trunc('month', p_as_of)::date;
  v_start date;
  v_used numeric := 0;
  m date;
begin
  select * into t from public.leave_types where id = p_type;
  if not found or not t.is_paid then return null; end if;
  if t.allowance_period = 'year' then
    return t.annual_quota - coalesce((select sum(r.days) from public.leave_requests r
      where r.employee_id = p_emp and r.leave_type_id = p_type and r.status in ('pending','approved')
        and extract(year from r.from_date) = extract(year from p_as_of)), 0);
  end if;
  if not t.carry_forward then
    return t.monthly_quota - private.leave_used_in_month(p_emp, p_type, v_month);
  end if;
  v_start := private.leave_start_month(p_emp, extract(year from p_as_of)::int);
  if v_start > v_month then return 0; end if;
  m := v_start;
  while m <= v_month loop
    v_used := v_used + private.leave_used_in_month(p_emp, p_type, m);
    m := (m + interval '1 month')::date;
  end loop;
  return t.monthly_quota * ((extract(year from v_month) - extract(year from v_start)) * 12 + extract(month from v_month) - extract(month from v_start) + 1) - v_used;
end $$;
revoke all on function private.leave_left(uuid, uuid, date) from public, anon, authenticated;

-- Refuses a new request that would go over the allowance. Runs before the request is saved,
-- so its own days are added on top of what is already booked.
create function private.check_leave_balance(p_emp uuid, p_type public.leave_types, p_from date, p_to date, p_half boolean, p_days numeric)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_used numeric;
  m date;
  m_end date;
  v_new numeric;
  v_cum_used numeric;
  v_cum_new numeric;
  v_start date;
  y int;
begin
  if not p_type.is_paid then return; end if;

  if p_type.allowance_period = 'year' then
    select coalesce(sum(r.days), 0) into v_used from public.leave_requests r
     where r.employee_id = p_emp and r.leave_type_id = p_type.id and r.status in ('pending','approved')
       and extract(year from r.from_date) = extract(year from p_from);
    if v_used + p_days > p_type.annual_quota then
      raise exception 'Not enough % balance: % day(s) left this year', p_type.name, p_type.annual_quota - v_used;
    end if;
    return;
  end if;

  if not p_type.carry_forward then
    -- Each month on its own: what is booked there plus this request's days there.
    m := date_trunc('month', p_from)::date;
    while m <= p_to loop
      m_end := (m + interval '1 month - 1 day')::date;
      v_new := case when p_half then 0.5 else private.leave_days_for(p_emp, greatest(p_from, m), least(p_to, m_end)) end;
      v_used := private.leave_used_in_month(p_emp, p_type.id, m);
      if v_new > 0 and v_used + v_new > p_type.monthly_quota then
        raise exception 'Not enough % balance for %: % day(s) left that month', p_type.name, to_char(m, 'FMMonth YYYY'), greatest(p_type.monthly_quota - v_used, 0);
      end if;
      m := (m + interval '1 month')::date;
    end loop;
    return;
  end if;

  -- Carry-over: by every month from this request to December, everything used so far that
  -- year (including this request) must fit in what has been earned by then.
  for y in extract(year from p_from)::int .. extract(year from p_to)::int loop
    v_start := private.leave_start_month(p_emp, y);
    v_cum_used := 0;
    v_cum_new := 0;
    m := v_start;
    while m <= make_date(y, 12, 1) loop
      m_end := (m + interval '1 month - 1 day')::date;
      v_cum_used := v_cum_used + private.leave_used_in_month(p_emp, p_type.id, m);
      v_new := case when p_from <= m_end and p_to >= m
                    then case when p_half then 0.5 else private.leave_days_for(p_emp, greatest(p_from, m), least(p_to, m_end)) end
                    else 0 end;
      v_cum_new := v_cum_new + v_new;
      -- Earned by the end of this month, counted from January (or the joining month).
      v_used := p_type.monthly_quota * ((extract(month from m) - extract(month from v_start)) + 1);
      if v_cum_new > 0 and v_cum_used + v_cum_new > v_used then
        raise exception 'Not enough % balance for %: % day(s) available by then', p_type.name, to_char(m, 'FMMonth YYYY'),
          greatest(v_used - v_cum_used - (v_cum_new - v_new), 0);
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
end $$;
revoke all on function private.check_leave_balance(uuid, public.leave_types, date, date, boolean, numeric) from public, anon, authenticated;

-- The caller's balances for the leave page: one row per active leave type.
create function public.my_leave_balances(p_year int) returns table (leave_type_id uuid, left_now numeric)
language sql stable security definer set search_path = '' as $$
  select t.id,
         private.leave_left(e.id, t.id,
           case when p_year = extract(year from (now() at time zone o.timezone))::int then (now() at time zone o.timezone)::date
                else make_date(p_year, 12, 31) end)
    from public.employees e
    join public.organizations o on o.id = e.org_id
    join public.leave_types t on t.org_id = e.org_id and t.is_paid
   where e.user_id = (select auth.uid()) and e.is_active
$$;
revoke all on function public.my_leave_balances(int) from public, anon;
grant execute on function public.my_leave_balances(int) to authenticated;

-- Use the new balance check in request_leave (the rest of the function is unchanged).
do $$
declare
  d text;
  n text;
  old_block text := $b$  if v_type.is_paid then
    select coalesce(sum(r.days), 0) into v_used from public.leave_requests r
     where r.employee_id = v_emp.id and r.leave_type_id = v_type.id and r.status in ('pending','approved')
       and extract(year from r.from_date) = extract(year from p_from);
    if v_used + v_days > v_type.annual_quota then
      raise exception 'Not enough % balance: % day(s) left this year', v_type.name, v_type.annual_quota - v_used;
    end if;
  end if;$b$;
begin
  d := pg_get_functiondef('public.request_leave(uuid,date,date,boolean,text)'::regprocedure);
  n := replace(d, old_block, '  perform private.check_leave_balance(v_emp.id, v_type, p_from, p_to, coalesce(p_half_day, false), v_days);');
  if n = d then raise exception 'request_leave: balance block not found'; end if;
  execute n;
end $$;

-- Manager summary: "left" follows the type's allowance (this month for monthly types).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.leave_wfh_summary(date,date,uuid)'::regprocedure);
  n := replace(d,
    $a$'quota', case when t.is_paid then t.annual_quota end,
             'left', case when t.is_paid then t.annual_quota - coalesce(u.used, 0) end$a$,
    $a$'period', t.allowance_period,
             'quota', case when not t.is_paid then null when t.allowance_period = 'month' then t.monthly_quota else t.annual_quota end,
             'left', case when t.is_paid then private.leave_left(s.id, t.id, least(p_to, (select (now() at time zone o2.timezone)::date from public.organizations o2 where o2.id = v_org))) end$a$);
  if n = d then raise exception 'leave_wfh_summary: quota block not found'; end if;
  execute n;
end $$;
