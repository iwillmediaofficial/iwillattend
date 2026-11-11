-- IWILL Attend: core schema (organisations, branches, employees, attendance, visits)
-- Already applied to the Supabase project. Kept here so the database can be rebuilt.

-- ============ Types ============
create type public.app_role as enum ('owner','admin','hr','manager','employee');
create type public.staff_type as enum ('office','field');

-- ============ Tables ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'Asia/Kolkata',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 20 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index branches_org_idx on public.branches(org_id);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  emp_code text,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null,
  phone text,
  designation text,
  department text,
  role public.app_role not null default 'employee',
  staff_type public.staff_type not null default 'office',
  branch_id uuid references public.branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);
create index employees_org_idx on public.employees(org_id);
create index employees_branch_idx on public.employees(branch_id);
create unique index employees_org_code_uidx on public.employees(org_id, emp_code) where emp_code is not null;

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  branch_id uuid references public.branches(id) on delete set null,
  check_in_at timestamptz not null,
  check_in_lat double precision not null,
  check_in_lng double precision not null,
  check_in_accuracy_m double precision,
  check_in_distance_m double precision,
  check_in_in_geofence boolean,
  check_in_selfie_path text not null,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_accuracy_m double precision,
  check_out_distance_m double precision,
  check_out_in_geofence boolean,
  check_out_selfie_path text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_org_date_idx on public.attendance(org_id, work_date);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  visited_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  selfie_path text not null,
  client_name text not null check (char_length(client_name) between 1 and 160),
  notes text check (notes is null or char_length(notes) <= 1000)
);
create index visits_org_date_idx on public.visits(org_id, work_date);
create index visits_employee_idx on public.visits(employee_id);

-- ============ Helper functions (not exposed over the API) ============
create schema if not exists private;
grant usage on schema private to authenticated;

create function private.my_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.org_id from public.employees e where e.user_id = (select auth.uid()) and e.is_active limit 1
$$;

create function private.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.user_id = (select auth.uid()) and e.is_active limit 1
$$;

create function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select e.role from public.employees e where e.user_id = (select auth.uid()) and e.is_active limit 1
$$;

create function private.is_org_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.my_role()) in ('owner','admin','hr'), false)
$$;

create function private.is_org_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.my_role()) in ('owner','admin','hr','manager'), false)
$$;

create function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ============ Guard: protect sensitive employee columns ============
create function private.guard_employee_update() returns trigger
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

create trigger employees_guard before update on public.employees
for each row execute function private.guard_employee_update();

-- ============ Row Level Security ============
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.visits enable row level security;

create policy org_select on public.organizations for select to authenticated
  using (id = (select private.my_org_id()));
create policy org_update on public.organizations for update to authenticated
  using (id = (select private.my_org_id()) and (select private.my_role()) in ('owner','admin'))
  with check (id = (select private.my_org_id()));

create policy branches_select on public.branches for select to authenticated
  using (org_id = (select private.my_org_id()));
create policy branches_insert on public.branches for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_admin()));
create policy branches_update on public.branches for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy employees_select on public.employees for select to authenticated
  using (user_id = (select auth.uid())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
create policy employees_update on public.employees for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_admin()))
  with check (org_id = (select private.my_org_id()));

create policy attendance_select on public.attendance for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));

create policy visits_select on public.visits for select to authenticated
  using (employee_id = (select private.my_employee_id())
     or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));

-- Table privileges: reads for signed-in users, writes only where a policy exists
revoke all on public.organizations, public.branches, public.employees, public.attendance, public.visits from anon;
grant select on public.organizations, public.branches, public.employees, public.attendance, public.visits to authenticated;
grant update (name, timezone) on public.organizations to authenticated;
grant insert, update on public.branches to authenticated;
grant update (emp_code, full_name, phone, designation, department, role, staff_type, branch_id, is_active) on public.employees to authenticated;

-- ============ RPC: create organisation (first-time owner onboarding) ============
create function public.create_organization(p_org_name text, p_full_name text)
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
  return v_org;
end $$;

-- ============ RPC: check in ============
create function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_branch public.branches;
  v_tz text;
  v_date date;
  v_dist double precision;
  v_in boolean;
  v_row public.attendance;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'A valid location is required';
  end if;
  if p_selfie_path is null or p_selfie_path not like v_emp.org_id::text || '/' || v_emp.id::text || '/%' then
    raise exception 'A selfie is required';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'selfies' and o.name = p_selfie_path) then
    raise exception 'Selfie upload not found';
  end if;

  select timezone into v_tz from public.organizations where id = v_emp.org_id;
  v_date := (now() at time zone v_tz)::date;

  if exists (select 1 from public.attendance where employee_id = v_emp.id and work_date = v_date) then
    raise exception 'You have already checked in today';
  end if;

  if v_emp.branch_id is not null then
    select * into v_branch from public.branches where id = v_emp.branch_id and is_active;
  end if;

  if v_emp.staff_type = 'office' then
    if v_branch.id is null then
      raise exception 'No branch is assigned to you. Ask your admin to assign one.';
    end if;
    v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
    v_in := v_dist <= v_branch.radius_m;
    if not v_in then
      raise exception 'You are % m from %. Check-in is allowed within % m.', round(v_dist), v_branch.name, v_branch.radius_m;
    end if;
  elsif v_branch.id is not null then
    v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
    v_in := v_dist <= v_branch.radius_m;
  end if;

  insert into public.attendance(org_id, employee_id, work_date, branch_id, check_in_at, check_in_lat, check_in_lng,
      check_in_accuracy_m, check_in_distance_m, check_in_in_geofence, check_in_selfie_path)
    values (v_emp.org_id, v_emp.id, v_date, v_branch.id, now(), p_lat, p_lng, p_accuracy, v_dist, v_in, p_selfie_path)
    returning * into v_row;
  return v_row;
end $$;

-- ============ RPC: check out ============
create function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_branch public.branches;
  v_row public.attendance;
  v_dist double precision;
  v_in boolean;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'A valid location is required';
  end if;
  if p_selfie_path is null or p_selfie_path not like v_emp.org_id::text || '/' || v_emp.id::text || '/%' then
    raise exception 'A selfie is required';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'selfies' and o.name = p_selfie_path) then
    raise exception 'Selfie upload not found';
  end if;

  select * into v_row from public.attendance
    where employee_id = v_emp.id and check_out_at is null
    order by check_in_at desc limit 1;
  if not found then raise exception 'No open check-in found'; end if;

  if v_row.branch_id is not null then
    select * into v_branch from public.branches where id = v_row.branch_id;
    if v_branch.id is not null then
      v_dist := private.distance_m(p_lat, p_lng, v_branch.latitude, v_branch.longitude);
      v_in := v_dist <= v_branch.radius_m;
    end if;
  end if;

  update public.attendance set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_accuracy_m = p_accuracy, check_out_distance_m = v_dist, check_out_in_geofence = v_in,
      check_out_selfie_path = p_selfie_path
    where id = v_row.id returning * into v_row;
  return v_row;
end $$;

-- ============ RPC: log a field visit ============
create function public.log_visit(p_lat double precision, p_lng double precision, p_accuracy double precision,
    p_selfie_path text, p_client_name text, p_notes text)
returns public.visits language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_tz text;
  v_row public.visits;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'A valid location is required';
  end if;
  if p_selfie_path is null or p_selfie_path not like v_emp.org_id::text || '/' || v_emp.id::text || '/%' then
    raise exception 'A selfie is required';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'selfies' and o.name = p_selfie_path) then
    raise exception 'Selfie upload not found';
  end if;
  select timezone into v_tz from public.organizations where id = v_emp.org_id;
  insert into public.visits(org_id, employee_id, work_date, latitude, longitude, accuracy_m, selfie_path, client_name, notes)
    values (v_emp.org_id, v_emp.id, (now() at time zone v_tz)::date, p_lat, p_lng, p_accuracy, p_selfie_path,
            trim(p_client_name), nullif(trim(coalesce(p_notes, '')), ''))
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.check_in(double precision, double precision, double precision, text) from public, anon;
revoke all on function public.check_out(double precision, double precision, double precision, text) from public, anon;
revoke all on function public.log_visit(double precision, double precision, double precision, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.check_in(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.check_out(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.log_visit(double precision, double precision, double precision, text, text, text) to authenticated;

-- ============ Storage: private selfie bucket ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy selfies_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'selfies'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
    and (storage.foldername(name))[2] = (select private.my_employee_id())::text);

create policy selfies_select on storage.objects for select to authenticated
  using (bucket_id = 'selfies'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
    and ((storage.foldername(name))[2] = (select private.my_employee_id())::text or (select private.is_org_manager())));
