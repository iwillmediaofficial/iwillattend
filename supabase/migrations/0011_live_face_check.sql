-- IWILL Attend: let staff see the face match result before confirming a punch,
-- with a limit on attempts and a record of failed ones for managers.

create table private.face_checks (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  matched boolean not null,
  consumed boolean not null default false, -- true once the punch these checks led to is saved
  created_at timestamptz not null default now()
);
create index face_checks_employee_idx on private.face_checks(employee_id, created_at);
alter table private.face_checks enable row level security;
revoke all on private.face_checks from public, anon, authenticated;

alter table public.attendance
  add column check_in_face_fails integer not null default 0,
  add column check_out_face_fails integer not null default 0;
alter table public.visits add column face_fails integer not null default 0;

-- Compares a selfie's face template with the registered one and returns only yes or no.
-- The registered template never leaves the server. Five checks are allowed per punch.
create function public.check_face(p_descriptor double precision[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_ref double precision[];
  v_n integer;
  v_match boolean;
begin
  if v_emp is null then raise exception 'No active employee record for this login'; end if;
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  select descriptor into v_ref from private.face_profiles where employee_id = v_emp;
  if v_ref is null then raise exception 'Face is not registered'; end if;
  select count(*) into v_n from private.face_checks
   where employee_id = v_emp and not consumed and created_at > now() - interval '10 minutes';
  if v_n >= 5 then
    raise exception 'Too many face checks. You can still confirm, and your manager will review this punch.';
  end if;
  v_match := private.face_distance(v_ref, p_descriptor) <= 0.55;
  insert into private.face_checks(employee_id, matched) values (v_emp, v_match);
  return json_build_object('matched', v_match, 'checks_left', 4 - v_n);
end $$;
revoke all on function public.check_face(double precision[]) from public, anon;
grant execute on function public.check_face(double precision[]) to authenticated;

-- Saving the result on the punch now also records how many checks failed beforehand.
create or replace function public.record_face(p_kind text, p_id uuid, p_descriptor double precision[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.my_employee_id();
  v_ref double precision[];
  v_d double precision;
  v_match boolean;
  v_fails integer;
  v_n integer;
begin
  if v_emp is null then raise exception 'No active employee record for this login'; end if;
  if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then raise exception 'Invalid face data'; end if;
  select descriptor into v_ref from private.face_profiles where employee_id = v_emp;
  if v_ref is null then raise exception 'Face is not registered'; end if;
  v_d := private.face_distance(v_ref, p_descriptor);
  v_match := v_d <= 0.55;
  select count(*) into v_fails from private.face_checks
   where employee_id = v_emp and not consumed and not matched and created_at > now() - interval '10 minutes';

  if p_kind = 'in' then
    update public.attendance set check_in_face_distance = v_d, check_in_face_match = v_match, check_in_face_fails = v_fails
     where id = p_id and employee_id = v_emp and check_in_face_match is null and check_in_at > now() - interval '10 minutes';
  elsif p_kind = 'out' then
    update public.attendance set check_out_face_distance = v_d, check_out_face_match = v_match, check_out_face_fails = v_fails
     where id = p_id and employee_id = v_emp and check_out_face_match is null and check_out_at > now() - interval '10 minutes';
  elsif p_kind = 'visit' then
    update public.visits set face_distance = v_d, face_match = v_match, face_fails = v_fails
     where id = p_id and employee_id = v_emp and face_match is null and visited_at > now() - interval '10 minutes';
  else
    raise exception 'Unknown punch type';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Punch not found or already verified'; end if;
  update private.face_checks set consumed = true where employee_id = v_emp and not consumed;
  return v_match;
end $$;
