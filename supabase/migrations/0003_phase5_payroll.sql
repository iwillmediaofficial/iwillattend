-- IWILL Attend phase 5: payroll rules, salary structures, monthly runs, payslips

create table public.payroll_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  pay_days_basis text not null default 'calendar' check (pay_days_basis in ('calendar','26','30')),
  pf_enabled boolean not null default true,
  pf_employee_pct numeric(5,2) not null default 12 check (pf_employee_pct between 0 and 100),
  pf_employer_pct numeric(5,2) not null default 12 check (pf_employer_pct between 0 and 100),
  pf_wage_ceiling numeric(12,2) not null default 15000 check (pf_wage_ceiling >= 0),
  esi_enabled boolean not null default true,
  esi_employee_pct numeric(5,2) not null default 0.75 check (esi_employee_pct between 0 and 100),
  esi_employer_pct numeric(5,2) not null default 3.25 check (esi_employer_pct between 0 and 100),
  esi_gross_limit numeric(12,2) not null default 21000 check (esi_gross_limit >= 0),
  pt_enabled boolean not null default false,
  pt_amount numeric(12,2) not null default 200 check (pt_amount >= 0),
  pt_min_gross numeric(12,2) not null default 15000 check (pt_min_gross >= 0),
  lates_per_half_day integer not null default 0 check (lates_per_half_day between 0 and 31),
  updated_at timestamptz not null default now()
);

create table public.salary_structures (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  basic numeric(12,2) not null default 0 check (basic >= 0),
  hra numeric(12,2) not null default 0 check (hra >= 0),
  allowances numeric(12,2) not null default 0 check (allowances >= 0),
  tds_monthly numeric(12,2) not null default 0 check (tds_monthly >= 0),
  pf_applicable boolean not null default true,
  esi_applicable boolean not null default true,
  bank_name text,
  bank_account text,
  ifsc text,
  pan text,
  uan text,
  updated_at timestamptz not null default now()
);
create index salary_structures_org_idx on public.salary_structures(org_id);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft','locked')),
  created_by uuid references public.employees(id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, month)
);
create index payroll_runs_creator_idx on public.payroll_runs(created_by);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  days_in_month integer not null,
  paid_days numeric(5,2) not null,
  unpaid_days numeric(5,2) not null default 0,
  late_count integer not null default 0,
  late_penalty_days numeric(4,1) not null default 0,
  basic numeric(12,2) not null default 0,
  hra numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0 check (bonus >= 0),
  gross numeric(12,2) not null default 0,
  pf_employee numeric(12,2) not null default 0,
  esi_employee numeric(12,2) not null default 0,
  pt numeric(12,2) not null default 0,
  tds numeric(12,2) not null default 0,
  other_deduction numeric(12,2) not null default 0 check (other_deduction >= 0),
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  pf_employer numeric(12,2) not null default 0,
  esi_employer numeric(12,2) not null default 0,
  unique (run_id, employee_id)
);
create index payslips_org_idx on public.payslips(org_id);
create index payslips_employee_idx on public.payslips(employee_id);

create function private.run_is_locked(p_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status = 'locked' from public.payroll_runs r where r.id = p_run), false)
$$;
revoke all on function private.run_is_locked(uuid) from public, anon;
grant execute on function private.run_is_locked(uuid) to authenticated;

alter table public.payroll_settings enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

create policy payroll_settings_select on public.payroll_settings for select to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy payroll_settings_insert on public.payroll_settings for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy payroll_settings_update on public.payroll_settings for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy salary_structures_select on public.salary_structures for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_admin())));
create policy salary_structures_insert on public.salary_structures for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin())
    and exists (select 1 from public.employees e where e.id = employee_id and e.org_id = salary_structures.org_id));
create policy salary_structures_update on public.salary_structures for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using (org_id = (select private.my_org_id()));
create policy payroll_runs_insert on public.payroll_runs for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy payroll_runs_update on public.payroll_runs for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

-- Employees see their own payslip only once the month is locked. Nobody can change a locked month.
create policy payslips_select on public.payslips for select to authenticated
  using ((org_id = (select private.my_org_id()) and (select private.is_org_admin()))
      or (employee_id = (select private.my_employee_id()) and private.run_is_locked(run_id)));
create policy payslips_insert on public.payslips for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()) and not private.run_is_locked(run_id)
    and exists (select 1 from public.payroll_runs r where r.id = run_id and r.org_id = payslips.org_id)
    and exists (select 1 from public.employees e where e.id = employee_id and e.org_id = payslips.org_id));
create policy payslips_update on public.payslips for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()) and not private.run_is_locked(run_id))
  with check (org_id = (select private.my_org_id()) and not private.run_is_locked(run_id));
create policy payslips_delete on public.payslips for delete to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()) and not private.run_is_locked(run_id));

revoke all on public.payroll_settings, public.salary_structures, public.payroll_runs, public.payslips from anon;
grant select, insert, update on public.payroll_settings, public.salary_structures, public.payroll_runs to authenticated;
grant select, insert, update, delete on public.payslips to authenticated;
