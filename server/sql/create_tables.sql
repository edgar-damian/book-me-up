-- ============================================================================
-- BOOKING PLATFORM — INITIAL SCHEMA
-- Target: Supabase (PostgreSQL 15+)
--
-- Run sections 0-7 in order. Section 8 (pg_cron) must be run separately
-- AFTER enabling pg_cron in Dashboard > Database > Extensions.
--
-- CONVENTIONS CHANGED FROM THE ERASER DIAGRAM (see notes in chat):
--   * snake_case identifiers (Postgres/PostgREST idiomatic, no quoting needed)
--   * "User" -> "app_user"  ("user" is a reserved word in Postgres)
--   * app_user.id references auth.users(id); hashed_password dropped
--     (Supabase Auth owns credentials in auth.users.encrypted_password)
--   * all timestamps are timestamptz
-- ============================================================================


-- ============================================================================
-- SECTION 0 — EXTENSIONS
-- ============================================================================
-- btree_gist lets an exclusion constraint mix equality (=) on scalar columns
-- with overlap (&&) on ranges. Required for the double-booking constraint.
create extension if not exists btree_gist;

-- If the exclusion constraints in Section 3 fail with
-- "operator class ... does not exist", your extension landed in a schema
-- outside search_path. Fix with:
--   drop extension btree_gist; create extension btree_gist with schema public;


begin;

-- ============================================================================
-- SECTION 1 — ENUMS
-- ============================================================================
create type appointment_status as enum (
  'PENDING',
  'ACCEPTED',
  'REJECTED',    -- worker actively declined
  'CANCELLED',   -- client cancelled, or hold expired (cancelled_by = SYSTEM)
  'COMPLETED',
  'NO_SHOW'
);

create type cancelled_by as enum ('CLIENT', 'WORKER', 'SYSTEM');


-- ============================================================================
-- SECTION 2 — TABLES
-- ============================================================================

-- ---------------------------------------------------------------- app_user --
-- Private account data. Mirrors auth.users; never exposed publicly.
create table public.app_user (
  id                uuid primary key references auth.users(id) on delete cascade,
  -- Nullable on purpose: Supabase Auth supports phone-only signup, where
  -- auth.users.email is NULL. A NOT NULL here would fail those signups.
  email             text,
  first_name        text        not null default '',
  last_name         text        not null default '',
  phone             text,
  is_platform_admin boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint app_user_phone_e164_ck
    check (phone is null or phone ~ '^\+[1-9][0-9]{1,14}$')
);

-- Lookup index only, NOT unique. auth.users already owns email uniqueness
-- (GoTrue lowercases and dedupes at signup). A second UNIQUE constraint here
-- could reject a user that Supabase Auth had already accepted, which would
-- surface as a failed signup with no useful error.
create index app_user_email_lower_idx on public.app_user (lower(email));


-- ----------------------------------------------------------- establishment --
create table public.establishment (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  address     text        not null,
  city        text        not null,
  state       text        not null,
  zip         text        not null,
  lat         double precision,
  lng         double precision,
  timezone    text        not null,  -- IANA, e.g. 'America/Boise'
  phone       text,
  email       text,
  hours       jsonb,                 -- display only, does not gate availability
  description text        not null default '',
  images      text[]      not null default '{}',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint establishment_slug_format_ck
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Rejects typos like 'America/Boisee' at write time rather than at
  -- availability-calculation time six weeks later.
  constraint establishment_timezone_valid_ck
    check (now() at time zone timezone is not null),

  constraint establishment_latlng_paired_ck
    check ((lat is null) = (lng is null)),
  constraint establishment_lat_range_ck
    check (lat is null or lat between -90 and 90),
  constraint establishment_lng_range_ck
    check (lng is null or lng between -180 and 180)
);


-- ----------------------------------------------------- establishment_owner --
create table public.establishment_owner (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references public.app_user(id) on delete cascade,
  establishment_id   uuid        not null references public.establishment(id) on delete cascade,
  can_manage_billing boolean     not null default false,
  created_at         timestamptz not null default now(),

  constraint establishment_owner_uniq unique (user_id, establishment_id)
);


-- ---------------------------------------------------------- worker_profile --
-- Public-facing barber identity. Decoupled from any one shop.
create table public.worker_profile (
  id            uuid    primary key default gen_random_uuid(),
  user_id       uuid    not null unique references public.app_user(id) on delete restrict,
  slug          text    not null unique,
  first_name    text    not null,
  last_name     text    not null,
  bio           text    not null default '',
  public_email  text,
  public_phone  text,
  image         text,
  is_active     boolean not null default true,

  -- booking policy, per chair
  hold_expiry_hours       integer not null default 24,
  auto_accept             boolean not null default false,
  min_lead_time_min       integer not null default 60,
  max_advance_days        integer not null default 60,
  cancellation_cutoff_min integer not null default 120,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint worker_profile_slug_format_ck
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint worker_profile_public_phone_e164_ck
    check (public_phone is null or public_phone ~ '^\+[1-9][0-9]{1,14}$'),
  constraint worker_profile_hold_expiry_ck
    check (hold_expiry_hours between 1 and 168),
  constraint worker_profile_min_lead_ck
    check (min_lead_time_min >= 0),
  constraint worker_profile_max_advance_ck
    check (max_advance_days between 1 and 365),
  constraint worker_profile_cancel_cutoff_ck
    check (cancellation_cutoff_min >= 0)
);


-- ---------------------------------------------------- worker_establishment --
-- One row per chair the worker rents. A worker can hold several.
create table public.worker_establishment (
  id               uuid        primary key default gen_random_uuid(),
  worker_id        uuid        not null references public.worker_profile(id) on delete cascade,
  establishment_id uuid        not null references public.establishment(id) on delete cascade,
  is_active        boolean     not null default true,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint worker_establishment_dates_ck
    check (ended_at is null or ended_at > started_at),
  constraint worker_establishment_ended_inactive_ck
    check (ended_at is null or is_active = false),

  -- Needed as the target of appointment's composite FK (Section 2, appointment).
  constraint worker_establishment_composite_uniq
    unique (id, worker_id, establishment_id)
);

-- A worker can only hold one ACTIVE stint per shop, but may have many
-- historical ones (left in 2024, came back in 2026).
create unique index worker_establishment_active_uidx
  on public.worker_establishment (worker_id, establishment_id)
  where is_active;


-- ------------------------------------------------------ worker_schedule_day --
-- Weekly recurring availability, scoped to the chair.
-- CONVENTION: one row per (chair, day). A midday break uses the break columns,
-- NOT a second row. Availability math depends on this being the only shape.
create table public.worker_schedule_day (
  id                       uuid        primary key default gen_random_uuid(),
  worker_establishment_id  uuid        not null references public.worker_establishment(id) on delete cascade,
  day_of_week              smallint    not null,  -- 0 = Sunday .. 6 = Saturday
  start_minute             integer     not null,  -- minutes from local midnight
  end_minute               integer     not null,
  break_start_minute       integer,
  break_end_minute         integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint worker_schedule_day_dow_ck
    check (day_of_week between 0 and 6),
  constraint worker_schedule_day_bounds_ck
    check (start_minute >= 0 and end_minute <= 1440 and start_minute < end_minute),
  constraint worker_schedule_day_break_paired_ck
    check ((break_start_minute is null) = (break_end_minute is null)),
  constraint worker_schedule_day_break_inside_ck
    check (
      break_start_minute is null
      or (break_start_minute >= start_minute
          and break_end_minute <= end_minute
          and break_start_minute < break_end_minute)
    ),

  -- Enforces the one-row-per-day convention and blocks
  -- "Mon 9-5" + "Mon 10-6" from coexisting.
  constraint worker_schedule_day_uniq unique (worker_establishment_id, day_of_week)
);


-- ---------------------------------------------------------- worker_time_off --
-- Person-scoped: blocks the worker at every shop simultaneously.
create table public.worker_time_off (
  id         uuid        primary key default gen_random_uuid(),
  worker_id  uuid        not null references public.worker_profile(id) on delete cascade,
  starts     timestamptz not null,
  ends       timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint worker_time_off_range_ck check (ends > starts)
);


-- ------------------------------------------------------------------ service --
create table public.service (
  id               uuid        primary key default gen_random_uuid(),
  worker_id        uuid        not null references public.worker_profile(id) on delete cascade,
  title            text        not null,
  description      text        not null default '',
  image            text,
  price_cents      integer     not null,
  duration_min     integer     not null,  -- net, client-facing
  buffer_after_min integer     not null default 0,  -- invisible padding
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint service_price_ck    check (price_cents >= 0),
  constraint service_duration_ck check (duration_min > 0 and duration_min <= 1440),
  constraint service_buffer_ck   check (buffer_after_min >= 0 and buffer_after_min <= 480)
);


-- ------------------------------------------------------------------- client --
-- Created only when someone willingly makes an account.
-- phone is intentionally NOT unique: one parent, one number, several kids.
create table public.client (
  id           uuid        primary key default gen_random_uuid(),
  phone        text        not null,  -- E.164, lookup key (returns 1..N rows)
  email        text,
  -- Defaulted like app_user's: a single-name client ('CJ') needs no surname.
  first_name   text        not null default '',
  last_name    text        not null default '',
  user_id      uuid        references public.app_user(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint client_phone_e164_ck check (phone ~ '^\+[1-9][0-9]{1,14}$')
);

-- Two profiles under one account can't share a name, otherwise the
-- booking-time "which kid?" picker is ambiguous.
create unique index client_user_name_uidx
  on public.client (user_id, lower(first_name), lower(last_name))
  where user_id is not null;


-- -------------------------------------------------------------- client_note --
-- Worker-private. Prefers client_id; falls back to phone/email matching
-- for guests who never made an account.
create table public.client_note (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        references public.client(id) on delete set null,
  client_phone text        not null,
  client_email text,
  worker_id    uuid        not null references public.worker_profile(id) on delete cascade,
  body         text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint client_note_phone_e164_ck check (client_phone ~ '^\+[1-9][0-9]{1,14}$')
);


-- -------------------------------------------------------------- appointment --
create table public.appointment (
  id                      uuid not null default gen_random_uuid() primary key,
  worker_establishment_id uuid not null,
  establishment_id        uuid not null,
  worker_id               uuid not null,
  service_id              uuid not null references public.service(id) on delete restrict,
  client_id               uuid references public.client(id) on delete set null,

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,  -- starts_at + duration_min (client sees this)
  block_ends_at timestamptz not null,  -- ends_at + buffer_after_min (chair blocked to here)

  -- snapshots taken at booking time; never join to service for display
  service_title    text    not null,
  price_cents      integer not null,
  duration_min     integer not null,
  buffer_after_min integer not null,

  status          appointment_status not null default 'PENDING',
  cancelled_by    cancelled_by,
  hold_expires_at timestamptz,

  client_name  text not null,
  client_phone text not null,
  client_email text,
  client_notes text,  -- client-authored, this booking only

  cancelled_at        timestamptz,
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Individual FKs: keeps PostgREST able to embed these relations.
  constraint appointment_worker_fk
    foreign key (worker_id) references public.worker_profile(id) on delete restrict,
  constraint appointment_establishment_fk
    foreign key (establishment_id) references public.establishment(id) on delete restrict,

  -- Composite FK: guarantees the denormalized worker_id/establishment_id
  -- actually match the stint. Without this you can book worker A at shop B
  -- where they have never worked.
  constraint appointment_stint_fk
    foreign key (worker_establishment_id, worker_id, establishment_id)
    references public.worker_establishment (id, worker_id, establishment_id)
    on delete restrict,

  constraint appointment_time_order_ck
    check (ends_at > starts_at and block_ends_at >= ends_at),
  constraint appointment_price_ck    check (price_cents >= 0),
  constraint appointment_duration_ck check (duration_min > 0),
  constraint appointment_buffer_ck   check (buffer_after_min >= 0),
  constraint appointment_phone_e164_ck
    check (client_phone ~ '^\+[1-9][0-9]{1,14}$'),

  -- A hold only means something while the request is outstanding.
  constraint appointment_hold_only_pending_ck
    check (hold_expires_at is null or status = 'PENDING'),

  -- Cancellation metadata must agree with status.
  constraint appointment_cancel_fields_ck
    check (
      case
        when status in ('CANCELLED', 'REJECTED')
          then cancelled_at is not null and cancelled_by is not null
        else cancelled_at is null
             and cancelled_by is null
             and cancellation_reason is null
      end
    )
);

-- THE double-booking guard. Keyed on worker_id, not worker_establishment_id:
-- a barber working two shops still cannot be in two chairs at once.
-- Uses block_ends_at so the buffer is protected too.
-- Only PENDING and ACCEPTED occupy the chair, so rejecting, cancelling,
-- or completing an appointment frees the slot automatically.
alter table public.appointment
  add constraint appointment_no_double_booking
  exclude using gist (
    worker_id with =,
    tstzrange(starts_at, block_ends_at, '[)') with &&
  ) where (status in ('PENDING', 'ACCEPTED'));


-- ============================================================================
-- SECTION 3 — INDEXES
-- ============================================================================
create index establishment_owner_est_idx      on public.establishment_owner (establishment_id);
create index worker_establishment_est_idx     on public.worker_establishment (establishment_id, is_active);
create index worker_establishment_worker_idx  on public.worker_establishment (worker_id, is_active);
create index worker_schedule_day_we_idx       on public.worker_schedule_day (worker_establishment_id);
create index worker_time_off_worker_idx       on public.worker_time_off (worker_id, starts, ends);
create index service_worker_active_idx        on public.service (worker_id) where is_active;

create index client_phone_idx                 on public.client (phone);
create index client_user_idx                  on public.client (user_id) where user_id is not null;

-- Guest note lookup goes through (worker, phone); account note lookup
-- through (worker, client_id). Both paths need cover.
create index client_note_worker_phone_idx     on public.client_note (worker_id, client_phone);
create index client_note_worker_client_idx    on public.client_note (worker_id, client_id) where client_id is not null;

create index appointment_worker_starts_idx    on public.appointment (worker_id, starts_at desc);
create index appointment_est_starts_idx       on public.appointment (establishment_id, starts_at desc);
create index appointment_client_idx           on public.appointment (client_id) where client_id is not null;
-- Load-bearing: guest appointment history is assembled by phone.
create index appointment_client_phone_idx     on public.appointment (client_phone, starts_at desc);
create index appointment_service_idx          on public.appointment (service_id);
-- Drives the hold-expiry sweeper in Section 8.
create index appointment_pending_holds_idx    on public.appointment (hold_expires_at) where status = 'PENDING';


-- ============================================================================
-- SECTION 4 — updated_at TRIGGERS
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_user_updated_at            before update on public.app_user            for each row execute function public.set_updated_at();
create trigger establishment_updated_at       before update on public.establishment       for each row execute function public.set_updated_at();
create trigger worker_profile_updated_at      before update on public.worker_profile      for each row execute function public.set_updated_at();
create trigger worker_establishment_updated_at before update on public.worker_establishment for each row execute function public.set_updated_at();
create trigger worker_schedule_day_updated_at before update on public.worker_schedule_day for each row execute function public.set_updated_at();
create trigger worker_time_off_updated_at     before update on public.worker_time_off     for each row execute function public.set_updated_at();
create trigger service_updated_at             before update on public.service             for each row execute function public.set_updated_at();
create trigger client_updated_at              before update on public.client              for each row execute function public.set_updated_at();
create trigger client_note_updated_at         before update on public.client_note         for each row execute function public.set_updated_at();
create trigger appointment_updated_at         before update on public.appointment         for each row execute function public.set_updated_at();

commit;


-- ============================================================================
-- SECTION 5 — OPTIONAL: DERIVED APPOINTMENT TIMES
-- Postgres can't express these as generated columns (timestamptz + interval
-- is STABLE, not IMMUTABLE), so a trigger is the only way to guarantee
-- ends_at / block_ends_at stay consistent with the snapshots.
-- Drop this block if you'd rather compute them in the app.
-- ============================================================================
create or replace function public.appointment_set_times()
returns trigger language plpgsql as $$
begin
  new.ends_at       := new.starts_at + make_interval(mins => new.duration_min);
  new.block_ends_at := new.ends_at   + make_interval(mins => new.buffer_after_min);
  return new;
end;
$$;

create trigger appointment_set_times_trg
  before insert or update of starts_at, duration_min, buffer_after_min
  on public.appointment
  for each row execute function public.appointment_set_times();


-- ============================================================================
-- SECTION 6 — REQUIRED: MIRROR auth.users INTO app_user
--
-- auth.users is the single source of truth for identity and credentials.
-- app_user is a read-mirror that PostgREST can actually join against
-- (the auth schema is not exposed through the API).
--
-- Expects first_name / last_name in raw_user_meta_data, i.e. pass them in
-- the `options.data` object of signUp(). Missing values fall back to ''
-- rather than raising, because anything this trigger throws aborts the
-- signup transaction and the client just sees a 500.
-- ============================================================================
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_user (id, email, first_name, last_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- Without this, a user changing their email or confirming a phone number in
-- Supabase Auth leaves app_user holding the stale value forever.
create or replace function public.handle_auth_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.app_user
     set email = new.email,
         phone = coalesce(new.phone, phone)
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, phone on auth.users
  for each row execute function public.handle_auth_user_updated();


-- ============================================================================
-- SECTION 7 — ROW LEVEL SECURITY
-- Starter policies. The public booking surface must be readable by anon;
-- everything else is locked to the owner or the worker.
-- Appointment writes are deliberately NOT open to anon — see notes in chat.
-- ============================================================================

alter table public.app_user             enable row level security;
alter table public.establishment        enable row level security;
alter table public.establishment_owner  enable row level security;
alter table public.worker_profile       enable row level security;
alter table public.worker_establishment enable row level security;
alter table public.worker_schedule_day  enable row level security;
alter table public.worker_time_off      enable row level security;
alter table public.service              enable row level security;
alter table public.client               enable row level security;
alter table public.client_note          enable row level security;
alter table public.appointment          enable row level security;

-- SECURITY DEFINER on these helpers is load-bearing: it stops a policy on
-- worker_profile from recursively re-evaluating worker_profile's own policy.
create or replace function public.current_worker_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.worker_profile where user_id = auth.uid();
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.app_user where id = auth.uid()), false);
$$;

create or replace function public.owns_establishment(est uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.establishment_owner
    where establishment_id = est and user_id = auth.uid()
  );
$$;

-- ---- public booking surface: readable by anyone ----
create policy establishment_public_read on public.establishment
  for select using (is_active);

create policy worker_profile_public_read on public.worker_profile
  for select using (is_active);

create policy worker_establishment_public_read on public.worker_establishment
  for select using (is_active);

create policy worker_schedule_day_public_read on public.worker_schedule_day
  for select using (true);

create policy service_public_read on public.service
  for select using (is_active);

-- ---- own account ----
-- Read-only. The auth triggers keep this row in sync, and a writable row would
-- let a user set their own is_platform_admin. The revoke keeps writes closed
-- even if a later policy opens them.
create policy app_user_self on public.app_user
  for select using (id = auth.uid());

revoke insert, update, delete on public.app_user from anon, authenticated;

-- ---- shop owners manage their shops ----
create policy establishment_owner_write on public.establishment
  for update using (owns_establishment(id)) with check (owns_establishment(id));

-- Owners see their own shops while they are still hidden.
create policy establishment_owner_read_own on public.establishment
  for select using (owns_establishment(id));

create policy establishment_owner_read on public.establishment_owner
  for select using (user_id = auth.uid() or owns_establishment(establishment_id));

-- ---- workers manage their own chair ----
create policy worker_profile_self_write on public.worker_profile
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- New profiles start hidden, and only go_live_if_ready() turns is_active on
-- (see GOING LIVE at the end). Self-read shows the hidden row, which an insert
-- also needs to return it.
create policy worker_profile_self_read on public.worker_profile
  for select using (user_id = auth.uid());

create policy worker_profile_self_insert on public.worker_profile
  for insert with check (user_id = auth.uid() and not is_active);

-- Joining a shop is a request: the worker inserts the chair inactive and only
-- an owner of that shop turns it on. An owner may add their own chair active,
-- never someone else's.
create policy worker_establishment_self_read on public.worker_establishment
  for select using (worker_id = current_worker_id() or owns_establishment(establishment_id));

create policy worker_establishment_self_insert on public.worker_establishment
  for insert with check (
    worker_id = current_worker_id()
    and (not is_active or owns_establishment(establishment_id))
  );

create policy worker_establishment_self_update on public.worker_establishment
  for update using (worker_id = current_worker_id() or owns_establishment(establishment_id))
  with check (
    (worker_id = current_worker_id() and not is_active)
    or owns_establishment(establishment_id)
  );

create policy worker_establishment_self_delete on public.worker_establishment
  for delete using (worker_id = current_worker_id() or owns_establishment(establishment_id));

-- A policy can't compare a row to its old version, so which worker and which
-- shop a chair belongs to are closed to updates by column instead.
revoke update on public.worker_establishment from anon, authenticated;
grant update (is_active, started_at, ended_at) on public.worker_establishment to authenticated;

create policy worker_schedule_day_self on public.worker_schedule_day
  for all using (
    worker_establishment_id in (
      select id from public.worker_establishment where worker_id = current_worker_id()
    )
  ) with check (
    worker_establishment_id in (
      select id from public.worker_establishment where worker_id = current_worker_id()
    )
  );

create policy worker_time_off_self on public.worker_time_off
  for all using (worker_id = current_worker_id())
  with check (worker_id = current_worker_id());

create policy service_self on public.service
  for all using (worker_id = current_worker_id())
  with check (worker_id = current_worker_id());

-- ---- client records ----
create policy client_self on public.client
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notes are private to the worker who wrote them, never shop-wide.
create policy client_note_worker_only on public.client_note
  for all using (worker_id = current_worker_id())
  with check (worker_id = current_worker_id());

-- ---- appointments ----
create policy appointment_read on public.appointment
  for select using (
    worker_id = current_worker_id()
    or owns_establishment(establishment_id)
    or client_id in (select id from public.client where user_id = auth.uid())
  );

create policy appointment_worker_write on public.appointment
  for update using (worker_id = current_worker_id() or owns_establishment(establishment_id))
  with check (worker_id = current_worker_id() or owns_establishment(establishment_id));

create policy appointment_platform_admin on public.appointment
  for all using (is_platform_admin()) with check (is_platform_admin());

-- ---- creating a shop ----
-- The only way to create a shop. An insert policy on establishment_owner would
-- let anyone claim any shop, so this writes both rows in one transaction with
-- the caller as owner. Shops start hidden; a taken slug fails on
-- establishment_slug_key.
create or replace function public.create_establishment(
  slug     text,
  name     text,
  address  text,
  city     text,
  state    text,
  zip      text,
  timezone text,
  phone    text default null,
  email    text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in to create a shop' using errcode = '42501';
  end if;

  insert into public.establishment
    (slug, name, address, city, state, zip, timezone, phone, email, is_active)
  values
    (slug, name, address, city, state, zip, timezone, phone, email, false)
  returning id into new_id;

  insert into public.establishment_owner (user_id, establishment_id, can_manage_billing)
  values (auth.uid(), new_id, true);

  return new_id;
end;
$$;

revoke execute on function public.create_establishment(text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.create_establishment(text, text, text, text, text, text, text, text, text) to authenticated;


-- ============================================================================
-- SECTION 8 — HOLD EXPIRY (run AFTER enabling pg_cron in the Dashboard)
-- ============================================================================
create or replace function public.expire_pending_appointments()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.appointment
     set status              = 'CANCELLED',
         cancelled_by        = 'SYSTEM',
         cancelled_at        = now(),
         cancellation_reason = 'Hold expired without a response',
         hold_expires_at     = null
   where status = 'PENDING'
     and hold_expires_at is not null
     and hold_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Dashboard > Database > Extensions > enable "pg_cron", then run:
--
--   select cron.schedule(
--     'expire-pending-appointments',
--     '*/5 * * * *',
--     $$ select public.expire_pending_appointments(); $$
--   );
--
-- Verify:  select * from cron.job;
-- Remove:  select cron.unschedule('expire-pending-appointments');

-- ============================================================================
-- FREE/BUSY VIEWS
--
-- The public booking calendar has to know when a barber is already taken, but
-- anon can read neither of the tables that hold that:
--
--   appointment      -- appointment_read is scoped to the worker, the shop
--                       owner, or the client themselves
--   worker_time_off  -- worker_time_off_self only, no public policy at all
--
-- Opening either table to anon would publish client names and phone numbers,
-- or the reason someone took a week off. These two views publish the time
-- columns and nothing else.
--
-- security_invoker = false is the 15+ default and is stated here on purpose:
-- the views run as their owner and therefore bypass the base tables' RLS.
-- That is the entire point, and it makes the SELECT list below the privacy
-- boundary. Adding a column here publishes it. Treat it like public_models.py.
--
-- Run after create_tables.sql. Safe to re-run.
-- ============================================================================

begin;

-- ------------------------------------------------------------ appointment --
-- Only PENDING and ACCEPTED occupy the chair -- same predicate as the
-- appointment_no_double_booking exclusion constraint, so the calendar and the
-- database agree on what "taken" means. PENDING holds still block the slot.
--
-- block_ends_at, not ends_at: the buffer is part of what is occupied.
create or replace view public.appointment_busy
with (security_invoker = false) as
select
  worker_id,
  worker_establishment_id,
  establishment_id,
  starts_at,
  block_ends_at
from public.appointment
where status in ('PENDING', 'ACCEPTED');


-- -------------------------------------------------------- worker_time_off --
-- Person-scoped, so this blocks the worker at every shop at once. `reason` is
-- deliberately not selected -- nobody booking a haircut needs to know why.
create or replace view public.worker_time_off_busy
with (security_invoker = false) as
select
  worker_id,
  starts,
  ends
from public.worker_time_off;


-- ---------------------------------------------------------------- grants --
-- Both views are simple enough that Postgres would treat them as
-- auto-updatable. Revoke first so SELECT is the only privilege either can
-- ever carry, no matter what a later `create or replace` leaves behind.
revoke all on public.appointment_busy     from anon, authenticated;
revoke all on public.worker_time_off_busy from anon, authenticated;

grant select on public.appointment_busy     to anon, authenticated;
grant select on public.worker_time_off_busy to anon, authenticated;

commit;

-- ============================================================================
-- WAITLIST
--
-- People who signed up on the landing page before launch. These are contact
-- details for people who are not users yet, so the table is closed to anon
-- and authenticated alike: RLS is on with no policies, and the server writes
-- through admin_db -- the same arrangement as the appointment insert.
--
-- received_offer starts false and records whether the launch offer has gone
-- out to this person.
--
-- Run after create_tables.sql. Safe to re-run.
-- ============================================================================

begin;

create table if not exists public.waitlist_signup (
  id              uuid        primary key default gen_random_uuid(),
  first_name      text        not null,
  last_name       text        not null,
  phone           text        not null,  -- E.164
  email           text        not null,  -- stored lowercased by the API
  submitted_at    timestamptz not null default now(),
  received_offer  boolean     not null default false,

  constraint waitlist_signup_phone_e164_ck check (phone ~ '^\+[1-9][0-9]{1,14}$')
);

-- One row per address, whatever its case. The API stores emails lowercased;
-- the index holds even if a row arrives some other way.
create unique index if not exists waitlist_signup_email_uq
  on public.waitlist_signup (lower(email));

alter table public.waitlist_signup enable row level security;
revoke all on public.waitlist_signup from anon, authenticated;

commit;

-- ============================================================================
-- GOING LIVE
--
-- A worker's page goes public on its own once they are ready: an approved
-- chair at a live shop, with hours at that chair, and at least one active
-- service. Whichever of those lands last turns worker_profile.is_active on,
-- so nobody has to press anything after the shop approves them. A page is
-- never turned back off here.
--
-- Workers can't set is_active themselves: update on that column is revoked,
-- and the function that sets it runs as its owner.
--
-- Run after create_tables.sql. Safe to re-run.
-- ============================================================================

begin;

create or replace function public.go_live_if_ready(worker uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.worker_profile
     set is_active = true
   where id = worker
     and not is_active
     and exists (select 1 from public.service where worker_id = worker and is_active)
     and exists (
       select 1
         from public.worker_establishment we
         join public.establishment e on e.id = we.establishment_id
        where we.worker_id = worker
          and we.is_active
          and e.is_active
          and exists (
            select 1 from public.worker_schedule_day d where d.worker_establishment_id = we.id
          )
     );
end;
$$;

-- Fired by the rows that carry worker_id: a chair turned on, a service offered.
create or replace function public.go_live_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.go_live_if_ready(new.worker_id);
  return null;
end;
$$;

-- Hours hang off the chair, so the worker is looked up through it.
create or replace function public.go_live_on_hours()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.go_live_if_ready(
    (select worker_id from public.worker_establishment where id = new.worker_establishment_id)
  );
  return null;
end;
$$;

drop trigger if exists go_live_on_chair on public.worker_establishment;
create trigger go_live_on_chair
  after insert or update of is_active on public.worker_establishment
  for each row when (new.is_active)
  execute function public.go_live_on_change();

drop trigger if exists go_live_on_service on public.service;
create trigger go_live_on_service
  after insert or update on public.service
  for each row when (new.is_active)
  execute function public.go_live_on_change();

-- Update as well as insert: saving hours is an upsert, and the rows that
-- already exist fire update triggers.
drop trigger if exists go_live_on_hours on public.worker_schedule_day;
create trigger go_live_on_hours
  after insert or update on public.worker_schedule_day
  for each row
  execute function public.go_live_on_hours();

-- Only the triggers call it, never the API.
revoke execute on function public.go_live_if_ready(uuid) from public, anon, authenticated;

-- A policy can't tell which columns an update touches, so is_active is closed
-- by column instead. Workers can still edit everything else on their profile.
revoke update on public.worker_profile from anon, authenticated;
grant update (
  slug, first_name, last_name, bio, public_email, public_phone, image,
  hold_expiry_hours, auto_accept, min_lead_time_min, max_advance_days,
  cancellation_cutoff_min
) on public.worker_profile to authenticated;

commit;
