-- Managers check in staff: Owner, Admin, HR and Manager can check another staff member in
-- or out with that person's live selfie and the manager's phone location. All the normal
-- rules apply (selfie freshness, office location, accuracy, face match, leave, locked
-- month, paused plan). Every such punch records who made it.

alter table public.organizations add column staff_checkin_enabled boolean not null default true;

alter table public.attendance
  add column check_in_by uuid references public.employees(id) on delete set null,
  add column check_in_by_name text,
  add column check_out_by uuid references public.employees(id) on delete set null,
  add column check_out_by_name text;
create index attendance_check_in_by_idx on public.attendance(check_in_by) where check_in_by is not null;
create index attendance_check_out_by_idx on public.attendance(check_out_by) where check_out_by is not null;

-- The calling manager, after checking they may act for p_target. Raises a clear error otherwise.
create function private.staff_checkin_actor(p_target uuid) returns public.employees
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_t public.employees;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr','manager') then
    raise exception 'Only an owner, admin, HR or manager can check in staff';
  end if;
  if not (select o.staff_checkin_enabled from public.organizations o where o.id = v_me.org_id) then
    raise exception 'Checking in staff is switched off for this company. The owner or an admin can turn it on in Settings.';
  end if;
  select * into v_t from public.employees where id = p_target;
  if not found or v_t.org_id <> v_me.org_id then raise exception 'Employee not found'; end if;
  if v_t.id = v_me.id then raise exception 'Use your own Attendance page to check yourself in'; end if;
  if not v_t.is_active then raise exception '% is deactivated', v_t.full_name; end if;
  if v_t.role in ('owner','admin') then raise exception 'Owners and admins do not have attendance'; end if;
  return v_me;
end $$;
revoke all on function private.staff_checkin_actor(uuid) from public, anon, authenticated;

-- ============ Selfie uploads into a staff member's folder ============
create or replace function public.selfie_access(p_path text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_target uuid;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or split_part(p_path, '/', 1) <> v_me.org_id::text then return false; end if;
  if split_part(p_path, '/', 2) = v_me.id::text then return true; end if;
  if not coalesce(p_write, true) then return v_me.role in ('owner','admin','hr','manager'); end if;
  -- Writing into someone else's folder: only a manager checking that person in.
  begin
    v_target := split_part(p_path, '/', 2)::uuid;
    perform private.staff_checkin_actor(v_target);
    return true;
  exception when others then
    return false;
  end;
end $$;

create or replace function public.register_selfie(p_path text, p_size integer, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
  v_owner uuid;
  v_secret text;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_me.org_id::text then raise exception 'Not allowed'; end if;
  begin
    v_owner := split_part(p_path, '/', 2)::uuid;
  exception when others then
    raise exception 'Not allowed';
  end;
  if v_owner <> v_me.id then perform private.staff_checkin_actor(v_owner); end if;
  if p_size is null or p_size < 1 or p_size > 1048576 then raise exception 'Invalid selfie size'; end if;
  select value into v_secret from private.app_secrets where name = 'media_secret';
  if v_secret is null then raise exception 'Media storage is not set up yet'; end if;
  if p_sig is null or p_sig <> encode(sha256(convert_to(v_secret || ':' || p_path || ':' || p_size || ':' || v_secret, 'UTF8')), 'hex') then
    raise exception 'Not allowed';
  end if;
  -- employee_id is the person the selfie belongs to (the folder), not necessarily the uploader.
  insert into private.selfie_uploads(path, org_id, employee_id, size_bytes) values (p_path, v_me.org_id, v_owner, p_size);
end $$;

-- ============ One check-in / check-out routine for both ways ============
create function private.do_check_in(v_emp public.employees, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_selfie_path text, v_by public.employees)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_branch public.branches;
  v_tz text;
  v_date date;
  v_dist double precision;
  v_in boolean;
  v_wfh boolean := false;
  v_site uuid;
  v_row public.attendance;
  v_who text := case when v_by.id is null then 'You have' else v_emp.full_name || ' has' end;
begin
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
    raise exception '% already checked in today', v_who;
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
      raise exception '% no branch assigned. Assign a branch in Employees first.', case when v_by.id is null then 'You have' else v_emp.full_name || ' has' end;
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
      check_in_accuracy_m, check_in_distance_m, check_in_in_geofence, check_in_selfie_path, is_wfh, site_assignment_id,
      check_in_by, check_in_by_name)
    values (v_emp.org_id, v_emp.id, v_date, v_branch.id, now(), p_lat, p_lng, p_accuracy, v_dist, v_in, p_selfie_path, v_wfh, v_site,
      v_by.id, v_by.full_name)
    returning * into v_row;
  return v_row;
end $$;
revoke all on function private.do_check_in(public.employees, double precision, double precision, double precision, text, public.employees) from public, anon, authenticated;

create function private.do_check_out(v_emp public.employees, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_selfie_path text, v_by public.employees)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_branch public.branches;
  v_row public.attendance;
  v_dist double precision;
  v_in boolean;
begin
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
    if v_by.id is null then
      raise exception 'No open check-in found. If you missed a check-out, request a correction from History.';
    end if;
    raise exception '% has no open check-in to close.', v_emp.full_name;
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
      check_out_selfie_path = p_selfie_path, check_out_by = v_by.id, check_out_by_name = v_by.full_name
    where id = v_row.id returning * into v_row;
  return v_row;
end $$;
revoke all on function private.do_check_out(public.employees, double precision, double precision, double precision, text, public.employees) from public, anon, authenticated;

-- Self check-in / check-out: unchanged behaviour, now through the shared routine.
create or replace function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  return private.do_check_in(v_emp, p_lat, p_lng, p_accuracy, p_selfie_path, null::public.employees);
end $$;

create or replace function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_emp public.employees;
begin
  select * into v_emp from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'No active employee record for this login'; end if;
  return private.do_check_out(v_emp, p_lat, p_lng, p_accuracy, p_selfie_path, null::public.employees);
end $$;

-- A manager checking a staff member in or out.
create function public.check_in_for(p_employee uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_by public.employees := private.staff_checkin_actor(p_employee);
  v_emp public.employees;
begin
  select * into v_emp from public.employees where id = p_employee;
  return private.do_check_in(v_emp, p_lat, p_lng, p_accuracy, p_selfie_path, v_by);
end $$;

create function public.check_out_for(p_employee uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_selfie_path text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  v_by public.employees := private.staff_checkin_actor(p_employee);
  v_emp public.employees;
begin
  select * into v_emp from public.employees where id = p_employee;
  return private.do_check_out(v_emp, p_lat, p_lng, p_accuracy, p_selfie_path, v_by);
end $$;

-- ============ Face check against the staff member's own template ============
create function public.check_face_for(p_employee uuid, p_descriptor double precision[]) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_ref double precision[];
  v_n integer;
  v_match boolean;
begin
  perform private.staff_checkin_actor(p_employee);
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  select descriptor into v_ref from private.face_profiles where employee_id = p_employee;
  if v_ref is null then raise exception 'This person has not registered their face'; end if;
  select count(*) into v_n from private.face_checks
   where employee_id = p_employee and not consumed and created_at > now() - interval '10 minutes';
  if v_n >= 5 then
    raise exception 'Too many face checks. You can still confirm; the punch will be flagged for review.';
  end if;
  v_match := private.face_distance(v_ref, p_descriptor) <= 0.55;
  insert into private.face_checks(employee_id, matched) values (p_employee, v_match);
  return json_build_object('matched', v_match, 'checks_left', 4 - v_n);
end $$;

create function public.record_face_for(p_employee uuid, p_kind text, p_id uuid, p_descriptor double precision[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees := private.staff_checkin_actor(p_employee);
  v_ref double precision[];
  v_d double precision;
  v_match boolean;
  v_fails integer;
  v_n integer;
begin
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  select descriptor into v_ref from private.face_profiles where employee_id = p_employee;
  if v_ref is null then raise exception 'This person has not registered their face'; end if;
  v_d := private.face_distance(v_ref, p_descriptor);
  v_match := v_d <= 0.55;
  select count(*) into v_fails from private.face_checks
   where employee_id = p_employee and not consumed and not matched and created_at > now() - interval '10 minutes';
  if p_kind = 'in' then
    update public.attendance set check_in_face_distance = v_d, check_in_face_match = v_match, check_in_face_fails = v_fails
     where id = p_id and employee_id = p_employee and check_in_by = v_me.id and check_in_face_match is null and check_in_at > now() - interval '10 minutes';
  elsif p_kind = 'out' then
    update public.attendance set check_out_face_distance = v_d, check_out_face_match = v_match, check_out_face_fails = v_fails
     where id = p_id and employee_id = p_employee and check_out_by = v_me.id and check_out_face_match is null and check_out_at > now() - interval '10 minutes';
  else
    raise exception 'Unknown punch type';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Punch not found or already verified'; end if;
  update private.face_checks set consumed = true where employee_id = p_employee and not consumed;
  return v_match;
end $$;

revoke all on function public.check_in_for(uuid, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.check_out_for(uuid, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.check_face_for(uuid, double precision[]) from public, anon;
revoke all on function public.record_face_for(uuid, text, uuid, double precision[]) from public, anon;
grant execute on function public.check_in_for(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.check_out_for(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.check_face_for(uuid, double precision[]) to authenticated;
grant execute on function public.record_face_for(uuid, text, uuid, double precision[]) to authenticated;

-- The marker columns are written only by the routines above.
-- Runs as the caller (security invoker): inside the routines above current_user is their owner,
-- while a direct write from the app runs as 'authenticated' and is refused.
create function private.attendance_marker_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and (new.check_in_by is not null or new.check_out_by is not null) then
      raise exception 'Not allowed';
    end if;
    if tg_op = 'UPDATE' and (new.check_in_by is distinct from old.check_in_by or new.check_in_by_name is distinct from old.check_in_by_name
        or new.check_out_by is distinct from old.check_out_by or new.check_out_by_name is distinct from old.check_out_by_name) then
      raise exception 'Not allowed';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.attendance_marker_guard() from public, anon, authenticated;
create trigger attendance_marker_guard before insert or update on public.attendance
  for each row execute function private.attendance_marker_guard();
