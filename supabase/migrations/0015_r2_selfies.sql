-- Selfies move to Cloudflare R2, written and read through the media Worker (media-worker/).
-- This step is additive: selfies already in Supabase Storage keep working, and the app can
-- still upload there until the Worker is live. 0016 closes Supabase uploads afterwards.
--
-- After applying, set the shared secret once (NOT stored in git), with the same value the
-- Worker has as MEDIA_SECRET:
--   insert into private.app_secrets(name, value) values ('media_secret', '<long random text>');

create table private.app_secrets (
  name text primary key,
  value text not null
);
alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated;

-- One row per selfie stored in R2, written only by register_selfie.
create table private.selfie_uploads (
  path text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);
create index selfie_uploads_emp_idx on private.selfie_uploads(employee_id);
create index selfie_uploads_org_idx on private.selfie_uploads(org_id, created_at);
alter table private.selfie_uploads enable row level security;
revoke all on private.selfie_uploads from public, anon, authenticated;

-- Asked by the Worker with the user's own token: may this user write / read this path?
-- Write: only into their own folder. Read: their own selfies, or any in their company for managers.
create function public.selfie_access(p_path text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select split_part(p_path, '/', 1) = e.org_id::text
       and (split_part(p_path, '/', 2) = e.id::text
            or (not coalesce(p_write, true) and e.role in ('owner','admin','hr','manager')))
      from public.employees e
     where e.user_id = (select auth.uid()) and e.is_active), false)
$$;

-- Called by the Worker after it stored a selfie in R2. The signature proves the call
-- comes from the Worker, so a user cannot claim an upload that never happened.
create function public.register_selfie(p_path text, p_size integer, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_secret text;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_path is null or p_path not like v_emp.org_id::text || '/' || v_emp.id::text || '/%' then
    raise exception 'Not allowed';
  end if;
  if p_size is null or p_size < 1 or p_size > 1048576 then raise exception 'Invalid selfie size'; end if;
  select value into v_secret from private.app_secrets where name = 'media_secret';
  if v_secret is null then raise exception 'Media storage is not set up yet'; end if;
  if p_sig is null or p_sig <> encode(sha256(convert_to(v_secret || ':' || p_path || ':' || p_size || ':' || v_secret, 'UTF8')), 'hex') then
    raise exception 'Not allowed';
  end if;
  insert into private.selfie_uploads(path, org_id, employee_id, size_bytes) values (p_path, v_emp.org_id, v_emp.id, p_size);
end $$;

revoke all on function public.selfie_access(text, boolean) from public, anon;
revoke all on function public.register_selfie(text, integer, text) from public, anon;
grant execute on function public.selfie_access(text, boolean) to authenticated;
grant execute on function public.register_selfie(text, integer, text) to authenticated;

-- Is there an uploaded selfie at this path (in R2, or still in Supabase Storage)?
create function private.selfie_exists(p_path text, p_fresh boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.selfie_uploads u
                  where u.path = p_path and (not p_fresh or u.created_at > now() - interval '5 minutes'))
      or exists (select 1 from storage.objects o
                  where o.bucket_id = 'selfies' and o.name = p_path and (not p_fresh or o.created_at > now() - interval '5 minutes'))
$$;
revoke all on function private.selfie_exists(text, boolean) from public, anon, authenticated;

create or replace function private.assert_fresh_selfie(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.selfie_exists(p_path, true) then
    raise exception 'That selfie is too old. Please take a new one.';
  end if;
  if exists (select 1 from public.attendance a where a.check_in_selfie_path = p_path or a.check_out_selfie_path = p_path)
     or exists (select 1 from public.visits v where v.selfie_path = p_path) then
    raise exception 'That selfie was already used. Please take a new one.';
  end if;
end $$;

-- check_in, check_out and log_visit: same as before, but the upload is looked up through selfie_exists.
create or replace function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_branch public.branches;
  v_tz text;
  v_date date;
  v_dist double precision;
  v_in boolean;
  v_wfh boolean := false;
  v_site uuid;
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
  if not private.selfie_exists(p_selfie_path, false) then
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
  select s.id into v_site from public.site_assignments s
    where s.employee_id = v_emp.id and s.status = 'active' and v_date between s.from_date and s.to_date
    order by s.created_at desc limit 1;
  if v_emp.staff_type = 'office' and v_site is null then
    v_wfh := exists (select 1 from public.wfh_requests w where w.employee_id = v_emp.id and w.status = 'approved'
                      and v_date between w.from_date and w.to_date);
  end if;

  if v_emp.staff_type = 'office' and not v_wfh and v_site is null then
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
      check_in_accuracy_m, check_in_distance_m, check_in_in_geofence, check_in_selfie_path, is_wfh, site_assignment_id)
    values (v_emp.org_id, v_emp.id, v_date, v_branch.id, now(), p_lat, p_lng, p_accuracy, v_dist, v_in, p_selfie_path, v_wfh, v_site)
    returning * into v_row;
  return v_row;
end $$;

create or replace function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
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
  if not private.selfie_exists(p_selfie_path, false) then
    raise exception 'Selfie upload not found';
  end if;

  select * into v_row from public.attendance
    where employee_id = v_emp.id and check_out_at is null and not missing_checkout
      and check_in_at > now() - interval '18 hours'
    order by check_in_at desc limit 1;
  if not found then
    raise exception 'No open check-in found. If you missed a check-out, request a correction from History.';
  end if;

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

create or replace function public.log_visit(p_lat double precision, p_lng double precision, p_accuracy double precision,
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
  if not private.selfie_exists(p_selfie_path, false) then
    raise exception 'Selfie upload not found';
  end if;
  select timezone into v_tz from public.organizations where id = v_emp.org_id;
  insert into public.visits(org_id, employee_id, work_date, latitude, longitude, accuracy_m, selfie_path, client_name, notes)
    values (v_emp.org_id, v_emp.id, (now() at time zone v_tz)::date, p_lat, p_lng, p_accuracy, p_selfie_path,
            trim(p_client_name), nullif(trim(coalesce(p_notes, '')), ''))
    returning * into v_row;
  return v_row;
end $$;
