-- Owner and Admin are supervisors: they manage the company but are not tracked as staff.
-- They cannot have attendance, visits, leave, WFH, corrections, site work, a registered face
-- or a salary, and they do not count toward the plan's employee limit.
-- HR, Manager and Employee are unchanged.

create function private.is_supervisor(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.role in ('owner','admin') from public.employees e where e.id = p_employee), false)
$$;
revoke all on function private.is_supervisor(uuid) from public, anon, authenticated;

-- Active staff that count toward the plan (everyone except Owner and Admin).
create function private.tracked_staff(p_org uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.employees e
   where e.org_id = p_org and e.is_active and e.role not in ('owner','admin')
$$;
revoke all on function private.tracked_staff(uuid) from public, anon, authenticated;

-- Refuses any staff record for an Owner or Admin.
create function private.block_supervisor_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_supervisor(new.employee_id) then
    raise exception 'Owners and admins supervise the company and do not have attendance, leave or salary records.';
  end if;
  return new;
end $$;
revoke all on function private.block_supervisor_record() from public, anon, authenticated;

create trigger attendance_no_supervisor before insert on public.attendance
  for each row execute function private.block_supervisor_record();
create trigger visits_no_supervisor before insert on public.visits
  for each row execute function private.block_supervisor_record();
create trigger leave_requests_no_supervisor before insert on public.leave_requests
  for each row execute function private.block_supervisor_record();
create trigger wfh_requests_no_supervisor before insert on public.wfh_requests
  for each row execute function private.block_supervisor_record();
create trigger correction_requests_no_supervisor before insert on public.correction_requests
  for each row execute function private.block_supervisor_record();
create trigger site_assignments_no_supervisor before insert on public.site_assignments
  for each row execute function private.block_supervisor_record();
create trigger face_profiles_no_supervisor before insert on private.face_profiles
  for each row execute function private.block_supervisor_record();
create trigger salary_structures_no_supervisor before insert on public.salary_structures
  for each row execute function private.block_supervisor_record();
create trigger payslips_no_supervisor before insert on public.payslips
  for each row execute function private.block_supervisor_record();

-- Plan limit: count only tracked staff.
create or replace function private.org_sub(p_org uuid)
returns table (plan_id text, plan_name text, max_employees integer, payroll boolean, face boolean, state text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.max_employees, p.payroll, p.face,
         case when o.sub_status = 'suspended' then 'suspended'
              when o.sub_status = 'active' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'expired'
              when o.over_limit_since is not null
                   and (now() at time zone o.timezone)::date - o.over_limit_since > 7
                   and private.tracked_staff(o.id) > p.max_employees then 'over_limit'
              else 'ok' end
    from public.organizations o
    join public.plans p on p.id = case
           when o.sub_status = 'trial' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'free'
           else o.plan_id end
   where o.id = p_org
$$;

create or replace function public.my_subscription()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'plan_id', s.plan_id, 'plan_name', s.plan_name, 'max_employees', s.max_employees,
    'payroll', s.payroll, 'face', s.face, 'state', s.state,
    'sub_status', o.sub_status, 'valid_until', o.valid_until, 'over_limit_since', o.over_limit_since,
    'active_employees', private.tracked_staff(o.id),
    'is_platform_admin', private.is_platform_admin())
  from public.organizations o, private.org_sub(o.id) s
  where o.id = private.my_org_id()
$$;

create or replace function public.admin_list_orgs()
returns table (id uuid, name text, created_at timestamptz, owner_name text, owner_email text, active_employees bigint,
               plan_id text, sub_status text, valid_until date, state text, last_check_in date, paid_total numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
    select o.id, o.name, o.created_at, ow.full_name, ow.email,
           private.tracked_staff(o.id),
           o.plan_id, o.sub_status, o.valid_until, s.state,
           (select max(a.work_date) from public.attendance a where a.org_id = o.id),
           (select coalesce(sum(p.amount), 0) from private.org_payments p where p.org_id = o.id)
      from public.organizations o
      cross join lateral private.org_sub(o.id) s
      left join lateral (select e.full_name, e.email from public.employees e where e.org_id = o.id and e.role = 'owner' limit 1) ow on true
     order by o.created_at desc;
end $$;

create or replace function private.hourly_maintenance()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.attendance set missing_checkout = true
   where check_out_at is null and not missing_checkout and check_in_at < now() - interval '18 hours';

  update public.organizations o
     set over_limit_since = case when x.over then (now() at time zone o.timezone)::date else null end
    from (select o2.id, private.tracked_staff(o2.id) > s.max_employees as over
            from public.organizations o2 cross join lateral private.org_sub(o2.id) s) x
   where x.id = o.id and (o.over_limit_since is null) = x.over;
end $$;

-- Re-evaluate the over-limit flag now that Owner and Admin no longer count.
select private.hourly_maintenance();
