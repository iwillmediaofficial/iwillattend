-- Assets & documents: company documents (certificates, licences, RC books, insurance)
-- and physical assets (vehicles, laptops, phones, tools), with expiry tracking,
-- private files in Cloudflare R2 (through the media Worker), document access for
-- assigned staff, and handover / return of physical assets.
--
-- Owner, Admin, HR and Manager add, edit, renew and delete. Other staff only see
-- the items assigned or handed over to them.

-- Storage allowance for document files, per plan.
alter table public.plans add column doc_storage_mb integer not null default 200 check (doc_storage_mb >= 0);
update public.plans set doc_storage_mb = case id when 'free' then 200 when 'standard' then 2048 when 'premium' then 5120 else doc_storage_mb end;

create table public.asset_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('document','asset')),
  category text not null check (char_length(category) between 2 and 60),
  name text not null check (char_length(name) between 2 and 120),
  ref_no text check (ref_no is null or char_length(ref_no) <= 80),
  issued_by text check (issued_by is null or char_length(issued_by) <= 120),
  brand_model text check (brand_model is null or char_length(brand_model) <= 120),
  issue_date date,
  expiry_date date,
  remind_days integer not null default 30 check (remind_days between 1 and 365),
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  condition text check (condition is null or condition in ('good','needs_repair','damaged','lost','retired')),
  branch_id uuid references public.branches(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  check (kind = 'asset' or condition is null)
);
create index asset_items_org_idx on public.asset_items(org_id, kind);
create index asset_items_expiry_idx on public.asset_items(org_id, expiry_date) where expiry_date is not null;
create index asset_items_branch_idx on public.asset_items(branch_id);
create index asset_items_creator_idx on public.asset_items(created_by);

-- Every document file stored in R2, written only by the media Worker (register_doc_upload).
create table private.doc_uploads (
  path text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  mime text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index doc_uploads_org_idx on private.doc_uploads(org_id);
alter table private.doc_uploads enable row level security;
revoke all on private.doc_uploads from public, anon, authenticated;

create table public.asset_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.asset_items(id) on delete cascade,
  path text not null unique references private.doc_uploads(path) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 160),
  mime text not null,
  size_bytes integer not null,
  -- Set when a renewal replaced this file; kept as history.
  replaced_at timestamptz,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index asset_files_item_idx on public.asset_files(item_id);
create index asset_files_org_idx on public.asset_files(org_id);
create index asset_files_uploader_idx on public.asset_files(uploaded_by);

-- Staff allowed to see a document (for example the field staff who drive a vehicle).
create table public.asset_assignments (
  item_id uuid not null references public.asset_items(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  assigned_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (item_id, employee_id)
);
create index asset_assignments_emp_idx on public.asset_assignments(employee_id);
create index asset_assignments_org_idx on public.asset_assignments(org_id);
create index asset_assignments_by_idx on public.asset_assignments(assigned_by);

-- Physical asset given to a person, and its return.
create table public.asset_handovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.asset_items(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  issued_on date not null,
  issued_condition text not null check (issued_condition in ('good','needs_repair','damaged')),
  issued_by uuid references public.employees(id) on delete set null,
  issue_notes text check (issue_notes is null or char_length(issue_notes) <= 500),
  returned_on date,
  returned_condition text check (returned_condition is null or returned_condition in ('good','needs_repair','damaged','lost')),
  received_by uuid references public.employees(id) on delete set null,
  return_notes text check (return_notes is null or char_length(return_notes) <= 500),
  created_at timestamptz not null default now(),
  check (returned_on is null or returned_on >= issued_on),
  check ((returned_on is null) = (returned_condition is null))
);
create unique index asset_handovers_open_uidx on public.asset_handovers(item_id) where returned_on is null;
create index asset_handovers_emp_idx on public.asset_handovers(employee_id);
create index asset_handovers_org_idx on public.asset_handovers(org_id);
create index asset_handovers_issuer_idx on public.asset_handovers(issued_by);
create index asset_handovers_receiver_idx on public.asset_handovers(received_by);

-- ============ Who can see what ============
create function private.can_see_asset(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.asset_items i
     where i.id = p_item and i.org_id = private.my_org_id()
       and (private.is_org_manager()
            or exists (select 1 from public.asset_assignments a where a.item_id = i.id and a.employee_id = private.my_employee_id())
            or exists (select 1 from public.asset_handovers h where h.item_id = i.id and h.employee_id = private.my_employee_id() and h.returned_on is null)))
$$;
revoke all on function private.can_see_asset(uuid) from public, anon, authenticated;
grant execute on function private.can_see_asset(uuid) to authenticated;

alter table public.asset_items enable row level security;
create policy asset_items_select on public.asset_items for select to authenticated using ((select private.can_see_asset(id)));
create policy asset_items_insert on public.asset_items for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy asset_items_update on public.asset_items for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()))
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy asset_items_delete on public.asset_items for delete to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()));

alter table public.asset_files enable row level security;
create policy asset_files_select on public.asset_files for select to authenticated using ((select private.can_see_asset(item_id)));
create policy asset_files_insert on public.asset_files for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy asset_files_update on public.asset_files for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()))
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));

alter table public.asset_assignments enable row level security;
create policy asset_assignments_select on public.asset_assignments for select to authenticated
  using (employee_id = (select private.my_employee_id())
         or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
create policy asset_assignments_insert on public.asset_assignments for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy asset_assignments_delete on public.asset_assignments for delete to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()));

alter table public.asset_handovers enable row level security;
create policy asset_handovers_select on public.asset_handovers for select to authenticated
  using (employee_id = (select private.my_employee_id())
         or (org_id = (select private.my_org_id()) and (select private.is_org_manager())));
create policy asset_handovers_insert on public.asset_handovers for insert to authenticated
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));
create policy asset_handovers_update on public.asset_handovers for update to authenticated
  using (org_id = (select private.my_org_id()) and (select private.is_org_manager()))
  with check (org_id = (select private.my_org_id()) and (select private.is_org_manager()));

revoke all on public.asset_items, public.asset_files, public.asset_assignments, public.asset_handovers from anon;
grant select, insert, update, delete on public.asset_items to authenticated;
grant select, insert, update on public.asset_files to authenticated;
grant select, insert, delete on public.asset_assignments to authenticated;
grant select, insert, update on public.asset_handovers to authenticated;

-- ============ Consistency checks ============
create function private.asset_item_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.kind <> old.kind) then
    raise exception 'The company and type of an item cannot be changed';
  end if;
  if new.branch_id is not null and not exists (select 1 from public.branches b where b.id = new.branch_id and b.org_id = new.org_id) then
    raise exception 'Choose a branch of this company';
  end if;
  if tg_op = 'INSERT' then new.created_by := private.my_employee_id(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.asset_item_guard() from public, anon, authenticated;
create trigger asset_items_guard before insert or update on public.asset_items
  for each row execute function private.asset_item_guard();

create function private.asset_file_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u private.doc_uploads;
begin
  if tg_op = 'UPDATE' then
    if new.path <> old.path or new.item_id <> old.item_id or new.org_id <> old.org_id then
      raise exception 'A file cannot be moved';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.asset_items i where i.id = new.item_id and i.org_id = new.org_id) then
    raise exception 'Item not found';
  end if;
  select * into u from private.doc_uploads where path = new.path;
  if not found or u.org_id <> new.org_id or new.path not like 'docs/' || new.org_id::text || '/' || new.item_id::text || '/%' then
    raise exception 'File upload not found';
  end if;
  if (select count(*) from public.asset_files f where f.item_id = new.item_id and f.replaced_at is null) >= 5 then
    raise exception 'An item can have at most 5 current files. Remove one first.';
  end if;
  -- Size and type come from the Worker's record, not from the browser.
  new.mime := u.mime;
  new.size_bytes := u.size_bytes;
  new.uploaded_by := private.my_employee_id();
  return new;
end $$;
revoke all on function private.asset_file_guard() from public, anon, authenticated;
create trigger asset_files_guard before insert or update on public.asset_files
  for each row execute function private.asset_file_guard();

create function private.asset_person_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.asset_items where id = new.item_id and org_id = new.org_id;
  if v_kind is null then raise exception 'Item not found'; end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id and e.is_active) then
    raise exception 'Choose an active employee of this company';
  end if;
  if tg_table_name = 'asset_handovers' then
    if v_kind <> 'asset' then raise exception 'Only physical assets are handed over. Assign documents instead.'; end if;
    if tg_op = 'INSERT' then
      new.issued_by := private.my_employee_id();
      if exists (select 1 from public.asset_items i where i.id = new.item_id and i.condition in ('lost','retired')) then
        raise exception 'A lost or retired asset cannot be handed over';
      end if;
    elsif new.employee_id <> old.employee_id or new.item_id <> old.item_id or new.issued_on <> old.issued_on then
      raise exception 'Record a return and a new handover instead of changing this one';
    elsif old.returned_on is not null then
      raise exception 'This handover is already closed';
    elsif new.returned_on is not null then
      new.received_by := private.my_employee_id();
      -- The item takes the condition it came back in.
      update public.asset_items set condition = new.returned_condition where id = new.item_id;
    end if;
  else
    new.assigned_by := private.my_employee_id();
  end if;
  return new;
end $$;
revoke all on function private.asset_person_guard() from public, anon, authenticated;
create trigger asset_handovers_guard before insert or update on public.asset_handovers
  for each row execute function private.asset_person_guard();
create trigger asset_assignments_guard before insert on public.asset_assignments
  for each row execute function private.asset_person_guard();

-- ============ Called by the media Worker ============
-- May this user write / read / delete this document path? A write also checks the plan's storage.
-- Path: docs/<org>/<item>/<uuid>.<pdf|jpg|png>
create function public.doc_access(p_path text, p_action text, p_size bigint default 0) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_item uuid;
  v_used bigint;
  v_quota bigint;
begin
  if p_path !~ '^docs/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$' then return false; end if;
  v_org := split_part(p_path, '/', 2)::uuid;
  v_item := split_part(p_path, '/', 3)::uuid;
  if v_org is distinct from private.my_org_id() then return false; end if;
  if p_action = 'read' then
    return private.can_see_asset(v_item)
       and exists (select 1 from public.asset_files f where f.path = p_path and f.item_id = v_item);
  end if;
  if not private.is_org_manager() then return false; end if;
  if p_action = 'delete' then
    return exists (select 1 from private.doc_uploads u where u.path = p_path and u.org_id = v_org);
  end if;
  if p_action <> 'write' then return false; end if;
  if not exists (select 1 from public.asset_items i where i.id = v_item and i.org_id = v_org) then return false; end if;
  select coalesce(sum(size_bytes), 0) into v_used from private.doc_uploads where org_id = v_org;
  select s.doc_storage_mb::bigint * 1048576 into v_quota
    from private.org_sub(v_org) s0 join public.plans s on s.id = s0.plan_id;
  if v_used + greatest(p_size, 0) > coalesce(v_quota, 0) then
    raise exception 'Document storage is full for your plan (% MB). Remove old files or upgrade the plan.', coalesce(v_quota, 0) / 1048576;
  end if;
  return true;
end $$;

create function public.register_doc_upload(p_path text, p_size integer, p_mime text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if not public.doc_access(p_path, 'write', p_size) then raise exception 'Not allowed'; end if;
  select value into v_secret from private.app_secrets where name = 'media_secret';
  if v_secret is null then raise exception 'Media storage is not set up yet'; end if;
  if p_sig is null or p_sig <> encode(sha256(convert_to(v_secret || ':' || p_path || ':' || p_size || ':' || v_secret, 'UTF8')), 'hex') then
    raise exception 'Not allowed';
  end if;
  insert into private.doc_uploads(path, org_id, size_bytes, mime, uploaded_by)
    values (p_path, split_part(p_path, '/', 2)::uuid, p_size, p_mime, private.my_employee_id());
end $$;

-- After the Worker removed the file from R2: forget it (its asset_files row goes with it).
create function public.forget_doc_upload(p_path text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if not public.doc_access(p_path, 'delete') then raise exception 'Not allowed'; end if;
  select value into v_secret from private.app_secrets where name = 'media_secret';
  if p_sig is null or v_secret is null
     or p_sig <> encode(sha256(convert_to(v_secret || ':' || p_path || ':delete:' || v_secret, 'UTF8')), 'hex') then
    raise exception 'Not allowed';
  end if;
  delete from private.doc_uploads where path = p_path;
end $$;

-- Storage used by the caller's company, for the usage bar.
create function public.doc_storage() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'used_bytes', (select coalesce(sum(size_bytes), 0) from private.doc_uploads u where u.org_id = private.my_org_id()),
    'quota_mb', (select p.doc_storage_mb from private.org_sub(private.my_org_id()) s join public.plans p on p.id = s.plan_id))
  where private.is_org_manager()
$$;

revoke all on function public.doc_access(text, text, bigint) from public, anon;
revoke all on function public.register_doc_upload(text, integer, text, text) from public, anon;
revoke all on function public.forget_doc_upload(text, text) from public, anon;
revoke all on function public.doc_storage() from public, anon;
grant execute on function public.doc_access(text, text, bigint) to authenticated;
grant execute on function public.register_doc_upload(text, integer, text, text) to authenticated;
grant execute on function public.forget_doc_upload(text, text) to authenticated;
grant execute on function public.doc_storage() to authenticated;

-- Files of a deleted item stay in R2 until the app removes them; list them for clean-up.
create function public.orphan_doc_uploads() returns setof text
language sql stable security definer set search_path = '' as $$
  select u.path from private.doc_uploads u
   where u.org_id = private.my_org_id() and private.is_org_manager()
     and not exists (select 1 from public.asset_files f where f.path = u.path)
     and u.created_at < now() - interval '1 hour'
$$;
revoke all on function public.orphan_doc_uploads() from public, anon;
grant execute on function public.orphan_doc_uploads() to authenticated;

-- A newly inserted row is not yet visible inside can_see_asset, so managers are also
-- matched directly; otherwise "insert ... returning" is refused.
drop policy asset_items_select on public.asset_items;
create policy asset_items_select on public.asset_items for select to authenticated
  using ((org_id = (select private.my_org_id()) and (select private.is_org_manager())) or (select private.can_see_asset(id)));
