-- IWILL Attend: face recognition (enrol once, compare on every punch, flag mismatches)

alter table public.organizations add column face_check_enabled boolean not null default true;
grant update (face_check_enabled) on public.organizations to authenticated;

alter table public.employees add column face_enrolled_at timestamptz;

-- Face templates live outside the API schema: no client can read them, only the functions below.
create table private.face_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  descriptor double precision[] not null check (array_length(descriptor, 1) = 128),
  consent_at timestamptz not null default now(),
  enrolled_at timestamptz not null default now()
);
alter table private.face_profiles enable row level security;
revoke all on private.face_profiles from public, anon, authenticated;

alter table public.attendance
  add column check_in_face_distance real,
  add column check_in_face_match boolean,
  add column check_out_face_distance real,
  add column check_out_face_match boolean;
alter table public.visits
  add column face_distance real,
  add column face_match boolean;

create function private.face_distance(a double precision[], b double precision[]) returns double precision
language sql immutable set search_path = '' as $$
  select sqrt(sum(power(x - y, 2))) from unnest(a, b) as t(x, y)
$$;
revoke all on function private.face_distance(double precision[], double precision[]) from public, anon;

create function public.enroll_face(p_descriptor double precision[], p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
begin
  if v_emp is null then raise exception 'No active employee record for this login'; end if;
  if not coalesce(p_consent, false) then raise exception 'Consent is required to register your face'; end if;
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  if exists (select 1 from private.face_profiles where employee_id = v_emp) then
    raise exception 'Your face is already registered. Ask your admin to reset it.';
  end if;
  insert into private.face_profiles(employee_id, descriptor) values (v_emp, p_descriptor);
  update public.employees set face_enrolled_at = now() where id = v_emp;
end $$;

create function public.reset_face(p_employee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.employees;
begin
  select * into v_me from public.employees where user_id = (select auth.uid()) and is_active;
  if not found or v_me.role not in ('owner','admin','hr') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.employees where id = p_employee and org_id = v_me.org_id) then
    raise exception 'Employee not found';
  end if;
  delete from private.face_profiles where employee_id = p_employee;
  update public.employees set face_enrolled_at = null where id = p_employee;
end $$;

-- Called right after a punch with the face template of that punch's selfie.
-- The comparison happens here, so the app cannot simply claim a match.
create function public.record_face(p_kind text, p_id uuid, p_descriptor double precision[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_ref double precision[];
  v_d double precision;
  v_match boolean;
  v_n integer;
begin
  if v_emp is null then raise exception 'No active employee record for this login'; end if;
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  select descriptor into v_ref from private.face_profiles where employee_id = v_emp;
  if v_ref is null then raise exception 'Face is not registered'; end if;
  v_d := private.face_distance(v_ref, p_descriptor);
  v_match := v_d <= 0.55;

  if p_kind = 'in' then
    update public.attendance set check_in_face_distance = v_d, check_in_face_match = v_match
     where id = p_id and employee_id = v_emp and check_in_face_match is null and check_in_at > now() - interval '10 minutes';
  elsif p_kind = 'out' then
    update public.attendance set check_out_face_distance = v_d, check_out_face_match = v_match
     where id = p_id and employee_id = v_emp and check_out_face_match is null and check_out_at > now() - interval '10 minutes';
  elsif p_kind = 'visit' then
    update public.visits set face_distance = v_d, face_match = v_match
     where id = p_id and employee_id = v_emp and face_match is null and visited_at > now() - interval '10 minutes';
  else
    raise exception 'Unknown punch type';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Punch not found or already verified'; end if;
  return v_match;
end $$;

revoke all on function public.enroll_face(double precision[], boolean) from public, anon;
revoke all on function public.reset_face(uuid) from public, anon;
revoke all on function public.record_face(text, uuid, double precision[]) from public, anon;
grant execute on function public.enroll_face(double precision[], boolean) to authenticated;
grant execute on function public.reset_face(uuid) to authenticated;
grant execute on function public.record_face(text, uuid, double precision[]) to authenticated;
