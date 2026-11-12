-- IWILL Attend phase 6: plans, subscriptions, limits and the platform (super-admin) panel

-- ============ Plans (public price list) ============
create table public.plans (
  id text primary key,
  name text not null,
  price_monthly numeric(10,2) not null default 0 check (price_monthly >= 0),
  max_employees integer not null check (max_employees > 0),
  payroll boolean not null default false,
  face boolean not null default false,
  sort_order integer not null default 0
);
insert into public.plans (id, name, price_monthly, max_employees, payroll, face, sort_order) values
  ('free', 'Free', 0, 10, false, false, 1),
  ('standard', 'Standard', 999, 50, true, false, 2),
  ('premium', 'Premium', 2499, 500, true, true, 3);
alter table public.plans enable row level security;
create policy plans_select on public.plans for select to anon, authenticated using (true);
revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;

-- ============ Subscription on each organisation ============
alter table public.organizations
  add column plan_id text not null default 'premium' references public.plans(id),
  add column sub_status text not null default 'trial' check (sub_status in ('trial','active','suspended')),
  add column valid_until date default (current_date + 14);
create index organizations_plan_idx on public.organizations(plan_id);
-- Companies that existed before plans were introduced keep full access with no end date.
update public.organizations set plan_id = 'premium', sub_status = 'active', valid_until = null;

-- ============ Platform admins and payment records (never exposed over the API) ============
create table private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.platform_admins enable row level security;
revoke all on private.platform_admins from public, anon, authenticated;
-- No platform admin is created here. Add one by hand in the Supabase SQL editor:
--   insert into private.platform_admins (user_id) values ('<auth user id>');

create table private.org_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text not null references public.plans(id),
  amount numeric(12,2) not null check (amount >= 0),
  paid_on date not null,
  valid_until date,
  reference text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index org_payments_org_idx on private.org_payments(org_id);
alter table private.org_payments enable row level security;
revoke all on private.org_payments from public, anon, authenticated;

-- ============ Effective subscription ============
-- A finished trial falls back to the Free plan. A lapsed paid plan is "expired". Suspended is set by the platform admin.
create function private.org_sub(p_org uuid)
returns table (plan_id text, plan_name text, max_employees integer, payroll boolean, face boolean, state text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.max_employees, p.payroll, p.face,
         case when o.sub_status = 'suspended' then 'suspended'
              when o.sub_status = 'active' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'expired'
              else 'ok' end
    from public.organizations o
    join public.plans p on p.id = case
           when o.sub_status = 'trial' and o.valid_until is not null and o.valid_until < (now() at time zone o.timezone)::date then 'free'
           else o.plan_id end
   where o.id = p_org
$$;
revoke all on function private.org_sub(uuid) from public, anon, authenticated;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins a where a.user_id = (select auth.uid()))
$$;
revoke all on function private.is_platform_admin() from public, anon, authenticated;

-- ============ Enforcement ============
create function private.enforce_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_org uuid;
  v_count integer;
begin
  if tg_table_name = 'face_profiles' then
    select e.org_id into v_org from public.employees e where e.id = new.employee_id;
  else
    v_org := new.org_id;
  end if;
  select * into s from private.org_sub(v_org);

  if tg_table_name in ('attendance', 'visits') then
    if s.state <> 'ok' then
      raise exception 'Attendance is paused because your company subscription is %. Please ask your admin to renew.', s.state;
    end if;
  elsif tg_table_name = 'employees' then
    -- Only adding a person, or reactivating one, counts against the plan.
    if tg_op = 'UPDATE' then
      if not new.is_active or old.is_active then
        return new;
      end if;
    end if;
    if s.state <> 'ok' then
      raise exception 'Employees cannot be added because your company subscription is %.', s.state;
    end if;
    select count(*) into v_count from public.employees where org_id = v_org and is_active and id <> new.id;
    if v_count >= s.max_employees then
      raise exception 'Your % plan allows % active employees. Upgrade your plan to add more.', s.plan_name, s.max_employees;
    end if;
  elsif tg_table_name = 'payroll_runs' then
    if not s.payroll or s.state <> 'ok' then
      raise exception 'Payroll is not included in your current plan.';
    end if;
  elsif tg_table_name = 'face_profiles' then
    if not s.face then
      raise exception 'Face recognition is not included in your current plan.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_subscription() from public, anon, authenticated;

create trigger attendance_subscription before insert on public.attendance for each row execute function private.enforce_subscription();
create trigger visits_subscription before insert on public.visits for each row execute function private.enforce_subscription();
create trigger employees_subscription before insert or update on public.employees for each row execute function private.enforce_subscription();
create trigger payroll_runs_subscription before insert on public.payroll_runs for each row execute function private.enforce_subscription();
create trigger face_profiles_subscription before insert on private.face_profiles for each row execute function private.enforce_subscription();

-- ============ RPC: what the signed-in user's company is entitled to ============
create function public.my_subscription() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'plan_id', s.plan_id, 'plan_name', s.plan_name, 'max_employees', s.max_employees,
    'payroll', s.payroll, 'face', s.face, 'state', s.state,
    'sub_status', o.sub_status, 'valid_until', o.valid_until,
    'active_employees', (select count(*) from public.employees e where e.org_id = o.id and e.is_active),
    'is_platform_admin', private.is_platform_admin())
  from public.organizations o, private.org_sub(o.id) s
  where o.id = private.my_org_id()
$$;

-- ============ RPCs: platform admin ============
create function public.admin_list_orgs()
returns table (id uuid, name text, created_at timestamptz, owner_name text, owner_email text, active_employees bigint,
               plan_id text, sub_status text, valid_until date, state text, last_check_in date, paid_total numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
    select o.id, o.name, o.created_at, ow.full_name, ow.email,
           (select count(*) from public.employees e where e.org_id = o.id and e.is_active),
           o.plan_id, o.sub_status, o.valid_until, s.state,
           (select max(a.work_date) from public.attendance a where a.org_id = o.id),
           (select coalesce(sum(p.amount), 0) from private.org_payments p where p.org_id = o.id)
      from public.organizations o
      cross join lateral private.org_sub(o.id) s
      left join lateral (select e.full_name, e.email from public.employees e where e.org_id = o.id and e.role = 'owner' limit 1) ow on true
     order by o.created_at desc;
end $$;

create function public.admin_update_org(p_org uuid, p_plan text, p_status text, p_valid_until date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  update public.organizations set plan_id = p_plan, sub_status = p_status, valid_until = p_valid_until where id = p_org;
  if not found then raise exception 'Company not found'; end if;
end $$;

create function public.admin_record_payment(p_org uuid, p_plan text, p_amount numeric, p_paid_on date, p_valid_until date, p_reference text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid amount'; end if;
  insert into private.org_payments(org_id, plan_id, amount, paid_on, valid_until, reference, note, recorded_by)
    values (p_org, p_plan, p_amount, coalesce(p_paid_on, current_date), p_valid_until,
            nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()));
  update public.organizations set plan_id = p_plan, sub_status = 'active', valid_until = p_valid_until where id = p_org;
  if not found then raise exception 'Company not found'; end if;
end $$;

create function public.admin_list_payments(p_org uuid)
returns table (id uuid, plan_id text, amount numeric, paid_on date, valid_until date, reference text, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query select p.id, p.plan_id, p.amount, p.paid_on, p.valid_until, p.reference, p.note
                 from private.org_payments p where p.org_id = p_org order by p.paid_on desc, p.created_at desc;
end $$;

create function public.admin_update_plan(p_id text, p_price numeric, p_max_employees integer, p_payroll boolean, p_face boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed'; end if;
  update public.plans set price_monthly = p_price, max_employees = p_max_employees, payroll = p_payroll, face = p_face where id = p_id;
  if not found then raise exception 'Plan not found'; end if;
end $$;

revoke all on function public.my_subscription() from public, anon;
revoke all on function public.admin_list_orgs() from public, anon;
revoke all on function public.admin_update_org(uuid, text, text, date) from public, anon;
revoke all on function public.admin_record_payment(uuid, text, numeric, date, date, text, text) from public, anon;
revoke all on function public.admin_list_payments(uuid) from public, anon;
revoke all on function public.admin_update_plan(text, numeric, integer, boolean, boolean) from public, anon;
grant execute on function public.my_subscription() to authenticated;
grant execute on function public.admin_list_orgs() to authenticated;
grant execute on function public.admin_update_org(uuid, text, text, date) to authenticated;
grant execute on function public.admin_record_payment(uuid, text, numeric, date, date, text, text) to authenticated;
grant execute on function public.admin_list_payments(uuid) to authenticated;
grant execute on function public.admin_update_plan(text, numeric, integer, boolean, boolean) to authenticated;
