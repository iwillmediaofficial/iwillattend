-- Apply ONLY after the media Worker is live and the app has VITE_MEDIA_URL set.
-- New selfies can then be stored only in R2. Old selfies in Supabase Storage stay viewable.

drop policy if exists selfies_insert on storage.objects;

-- A new punch must use a selfie registered by the Worker; Supabase Storage no longer counts.
create or replace function private.selfie_exists(p_path text, p_fresh boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.selfie_uploads u
                  where u.path = p_path and (not p_fresh or u.created_at > now() - interval '5 minutes'))
$$;
