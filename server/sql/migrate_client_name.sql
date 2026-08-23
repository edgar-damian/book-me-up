-- ============================================================================
-- client.display_name  ->  client.first_name + client.last_name
--
-- Nothing in the application reads display_name (no query, no public model, no
-- route, no frontend), so this is a schema + generated-model change only. There
-- is no window where running code expects the old column.
--
-- Run this in the Supabase SQL editor, then regenerate the models:
--   uv run python scripts/gen_models.py
--
-- Safe to re-run. Idempotent via IF EXISTS / IF NOT EXISTS guards, and the
-- backfill is skipped once display_name is gone.
-- ============================================================================

begin;

-- `not null default ''` matches app_user.first_name/last_name, and lets a
-- single-name client ('CJ', 'Thomas') exist without inventing a surname.
alter table public.client
  add column if not exists first_name text not null default '',
  add column if not exists last_name  text not null default '';


-- Backfill: first whitespace-delimited token is the given name, the remainder
-- is everything else.  'Larry the Lobster' -> 'Larry' / 'the Lobster';
-- 'CJ' -> 'CJ' / ''.  Guarded so a re-run after the drop is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'client'
       and column_name  = 'display_name'
  ) then
    update public.client
       set first_name = split_part(display_name, ' ', 1),
           last_name  = ltrim(substr(display_name,
                                     length(split_part(display_name, ' ', 1)) + 1));
  end if;
end $$;


-- The old index encoded "two profiles under one account can't collide" against
-- a single column. Same rule, now across the split pair. Dropped explicitly
-- rather than relying on the column drop to cascade it away.
drop index if exists public.client_user_display_name_uidx;

create unique index if not exists client_user_name_uidx
  on public.client (user_id, lower(first_name), lower(last_name))
  where user_id is not null;

alter table public.client drop column if exists display_name;

commit;
