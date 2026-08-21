-- =============================================================================
-- book-me-up :: mock seed data
--
--   Two establishments, ten barbers/artists, thirteen clients, forty-one
--   appointments spanning three weeks of history and two weeks of future.
--
--     Krusty Fadez  (SpongeBob)     -- Bikini Bottom, Pacific/Kwajalein (UTC+12)
--     Regular Cutz  (Regular Show)  -- Twin Peaks CA,  America/Los_Angeles
--
-- HOW TO RUN
--   Paste the WHOLE file into the Supabase SQL editor and run it in one shot.
--   It must run as `postgres`: it writes to auth.* and relies on bypassing RLS.
--   Do not run the statements one at a time -- the pg_temp helpers below are
--   session-scoped, and the whole thing is one transaction.
--
--   Re-running is safe. The cleanup block deletes exactly these rows first.
--
-- LOGIN
--   Every seeded account has the password `bookmeup123`, email confirmed.
--   e.g. spongebob@krustyfadez.test / bookmeup123
--
-- WHY auth.users AND NOT app_user
--   public.app_user.id is a FK to auth.users(id), and the `on_auth_user_created`
--   trigger calls handle_new_auth_user(), which inserts the app_user row from
--   raw_user_meta_data. So we insert into auth.users and let the trigger build
--   app_user. Inserting into app_user directly would violate the FK.
--
-- UUID LEGEND  (fixed ids so the file is deterministic and greppable)
--   00000001-...  app users / auth users
--   00000002-...  establishment
--   00000003-...  worker_profile
--   00000004-...  worker_establishment   ("the chair")
--   00000005-...  service
--   00000006-...  client
--   00000007-...  appointment
--   00000008-...  client_note
--   00000009-...  worker_time_off
--   0000000a-...  establishment_owner
--   worker_schedule_day uses gen_random_uuid() -- nothing references it.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. CLEANUP  (idempotency)
--
-- Order matters. appointment's FKs to establishment / worker_profile / service /
-- worker_establishment are all ON DELETE RESTRICT, so appointments go first.
-- worker_profile.user_id -> app_user is RESTRICT too, so worker profiles must be
-- gone before we touch auth.users.
-- -----------------------------------------------------------------------------

delete from public.appointment
 where establishment_id in ('00000002-0000-4000-8000-000000000001',
                            '00000002-0000-4000-8000-000000000002');

delete from public.client_note
 where worker_id in (select id from public.worker_profile
                      where slug in ('eugene-krabs','spongebob-squarepants','patrick-star',
                                     'squidward-tentacles','sandy-cheeks','benson-dunwoody',
                                     'mordecai-jay','rigby-raccoon','skips-yeti','pops-maellard'));

delete from public.client
 where id >= '00000006-0000-4000-8000-000000000000'
   and id <= '00000006-0000-4000-8000-0000000000ff';

-- cascades worker_establishment -> worker_schedule_day, and establishment_owner
delete from public.establishment
 where id in ('00000002-0000-4000-8000-000000000001',
              '00000002-0000-4000-8000-000000000002');

-- cascades service and worker_time_off
delete from public.worker_profile
 where slug in ('eugene-krabs','spongebob-squarepants','patrick-star',
                'squidward-tentacles','sandy-cheeks','benson-dunwoody',
                'mordecai-jay','rigby-raccoon','skips-yeti','pops-maellard');

-- cascades public.app_user and auth.identities
delete from auth.users
 where id >= '00000001-0000-4000-8000-000000000000'
   and id <= '00000001-0000-4000-8000-0000000000ff';


-- -----------------------------------------------------------------------------
-- 1. TIME HELPERS
--
-- worker_schedule_day stores minutes local to establishment.timezone, but every
-- DateTime column is an absolute instant. These two functions are the ONLY place
-- that conversion happens -- one per shop, matching its own timezone.
--
--   pg_temp.kf(weeks, dow, 'HH:MM')  -> Krusty Fadez local time as timestamptz
--   pg_temp.rc(weeks, dow, 'HH:MM')  -> Regular Cutz local time as timestamptz
--
--   weeks: 0 = this week, -1 = last week, +1 = next week
--   dow:   0 = Sunday ... 6 = Saturday  (same convention as worker_schedule_day)
--
-- Anchoring on the week means the data stays sane whenever you run it: history
-- (weeks <= -1) is always in the past and future rows (weeks >= +1) are always
-- ahead, and every booking still lands on a day its barber actually works.
-- -----------------------------------------------------------------------------

create or replace function pg_temp.kf(p_weeks int, p_dow int, p_time text)
returns timestamptz language sql stable as $$
  select (date_trunc('week', now() at time zone 'Pacific/Kwajalein')  -- Monday
          - interval '1 day'                                          -- -> Sunday
          + make_interval(weeks => p_weeks, days => p_dow)
          + p_time::time) at time zone 'Pacific/Kwajalein'
$$;

create or replace function pg_temp.rc(p_weeks int, p_dow int, p_time text)
returns timestamptz language sql stable as $$
  select (date_trunc('week', now() at time zone 'America/Los_Angeles')
          - interval '1 day'
          + make_interval(weeks => p_weeks, days => p_dow)
          + p_time::time) at time zone 'America/Los_Angeles'
$$;


-- -----------------------------------------------------------------------------
-- 2. AUTH USERS  -> public.app_user via the on_auth_user_created trigger
--
-- This is the PRIVATE identity (PII). Note the phone numbers here are the real
-- personal ones; the numbers that appear publicly live on worker_profile and are
-- deliberately different. That duplication is the privacy boundary.
--
-- auth.users.phone is left NULL on purpose -- it carries a UNIQUE index, and
-- handle_new_auth_user() reads the phone out of raw_user_meta_data anyway.
-- -----------------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  v.email,
  extensions.crypt('bookmeup123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('first_name', v.first_name, 'last_name', v.last_name, 'phone', v.phone),
  now(), now()
from (values
  -- Krusty Fadez
  ('00000001-0000-4000-8000-000000000001'::uuid, 'krabs@krustyfadez.test',      'Eugene',    'Krabs',        '+16925559001'),
  ('00000001-0000-4000-8000-000000000002'::uuid, 'spongebob@krustyfadez.test',  'SpongeBob', 'SquarePants',  '+16925559002'),
  ('00000001-0000-4000-8000-000000000003'::uuid, 'patrick@krustyfadez.test',    'Patrick',   'Star',         '+16925559003'),
  ('00000001-0000-4000-8000-000000000004'::uuid, 'squidward@krustyfadez.test',  'Squidward', 'Tentacles',    '+16925559004'),
  ('00000001-0000-4000-8000-000000000005'::uuid, 'sandy@krustyfadez.test',      'Sandy',     'Cheeks',       '+16925559005'),
  -- Regular Cutz
  ('00000001-0000-4000-8000-000000000006'::uuid, 'benson@regularcutz.test',     'Benson',    'Dunwoody',     '+18185559006'),
  ('00000001-0000-4000-8000-000000000007'::uuid, 'mordecai@regularcutz.test',   'Mordecai',  'Jay',          '+18185559007'),
  ('00000001-0000-4000-8000-000000000008'::uuid, 'rigby@regularcutz.test',      'Rigby',     'Raccoon',      '+18185559008'),
  ('00000001-0000-4000-8000-000000000009'::uuid, 'skips@regularcutz.test',      'Skips',     'Yeti',         '+18185559009'),
  ('00000001-0000-4000-8000-000000000010'::uuid, 'pops@regularcutz.test',       'Pops',      'Maellard',     '+18185559010'),
  -- client-side accounts (people who chose to sign up rather than book as guests)
  ('00000001-0000-4000-8000-000000000011'::uuid, 'plankton@bikinibottom.test',  'Sheldon',   'Plankton',     '+16925552001'),
  ('00000001-0000-4000-8000-000000000012'::uuid, 'muscleman@twinpeaks.test',    'Mitch',     'Sorrenstein',  '+18185552008')
) as v(id, email, first_name, last_name, phone);

-- Email/password identities, so GoTrue actually accepts a sign-in.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from auth.users u
where u.id >= '00000001-0000-4000-8000-000000000000'
  and u.id <= '00000001-0000-4000-8000-0000000000ff';


-- -----------------------------------------------------------------------------
-- 3. ESTABLISHMENTS
--
-- `hours` is a display field for the shop's front page. The authoritative
-- bookable window is worker_schedule_day, per chair.
-- -----------------------------------------------------------------------------

insert into public.establishment
  (id, slug, name, address, city, state, zip, lat, lng, timezone, phone, email, hours, description, images, is_active)
values
  ('00000002-0000-4000-8000-000000000001',
   'krusty-fadez', 'Krusty Fadez',
   '831 Bottom Feeder Lane', 'Bikini Bottom', 'MH', '96970',
   11.63, 165.38, 'Pacific/Kwajalein',
   '+16925550100', 'hello@krustyfadez.test',
   '{"sun":{"open":"10:00","close":"16:00"},
     "mon":{"open":"08:00","close":"20:00"},
     "tue":{"open":"08:00","close":"20:00"},
     "wed":{"open":"08:00","close":"20:00"},
     "thu":{"open":"08:00","close":"20:00"},
     "fri":{"open":"08:00","close":"20:00"},
     "sat":{"open":"08:00","close":"20:00"}}'::jsonb,
   'Five chairs, one fryer, and the finest lineups under the sea. Cuts, ink, and nails since the day the register was installed.',
   array['https://images.bookmeup.test/krusty-fadez/storefront.jpg',
         'https://images.bookmeup.test/krusty-fadez/chairs.jpg',
         'https://images.bookmeup.test/krusty-fadez/anchor-sign.jpg'],
   true),

  ('00000002-0000-4000-8000-000000000002',
   'regular-cutz', 'Regular Cutz',
   '1 Park Avenue', 'Twin Peaks', 'CA', '91302',
   34.05, -118.24, 'America/Los_Angeles',
   '+18185550100', 'frontdesk@regularcutz.test',
   '{"sun":null,
     "mon":null,
     "tue":{"open":"09:00","close":"20:00"},
     "wed":{"open":"09:00","close":"20:00"},
     "thu":{"open":"09:00","close":"20:00"},
     "fri":{"open":"09:00","close":"20:00"},
     "sat":{"open":"09:00","close":"20:00"}}'::jsonb,
   'A barbershop out behind the park. The chairs are clean, the coffee is free, and somebody is always about to get fired.',
   array['https://images.bookmeup.test/regular-cutz/front.jpg',
         'https://images.bookmeup.test/regular-cutz/waiting-couch.jpg'],
   true);


-- -----------------------------------------------------------------------------
-- 4. OWNERS  (role is derived from this row existing -- nothing is stored)
--
-- Krabs and Benson are BOTH owners and working barbers. They get an
-- establishment_owner row AND a worker_profile, which is exactly the case the
-- derived-roles design is meant to handle.
-- -----------------------------------------------------------------------------

insert into public.establishment_owner (id, user_id, establishment_id, can_manage_billing)
values
  ('0000000a-0000-4000-8000-000000000001', '00000001-0000-4000-8000-000000000001',
   '00000002-0000-4000-8000-000000000001', true),   -- Mr. Krabs owns Krusty Fadez
  ('0000000a-0000-4000-8000-000000000002', '00000001-0000-4000-8000-000000000006',
   '00000002-0000-4000-8000-000000000002', true);   -- Benson owns Regular Cutz


-- -----------------------------------------------------------------------------
-- 5. WORKER PROFILES  (the PUBLIC presence -- safe to render on the web)
--
-- Names and contact details are duplicated from app_user on purpose. The public
-- phone/email here are shop-facing; the personal ones on app_user never ship.
--
-- Booking policy travels with the PERSON, not the chair -- so Skips has the same
-- zero-lead-time policy at both shops.
-- -----------------------------------------------------------------------------

insert into public.worker_profile
  (id, user_id, slug, first_name, last_name, bio, public_email, public_phone, image, is_active,
   hold_expiry_hours, auto_accept, min_lead_time_min, max_advance_days, cancellation_cutoff_min)
values
  -- ---- Krusty Fadez ----------------------------------------------------------
  ('00000003-0000-4000-8000-000000000001', '00000001-0000-4000-8000-000000000001',
   'eugene-krabs', 'Eugene', 'Krabs',
   'Owner, operator, and the only barber here who counts the hairs on the floor. Forty years behind the chair and not one refund.',
   'krabs@krustyfadez.test', '+16925550101',
   'https://images.bookmeup.test/workers/krabs.jpg', true,
   48, false, 120, 90, 1440),   -- approves every booking himself

  ('00000003-0000-4000-8000-000000000002', '00000001-0000-4000-8000-000000000002',
   'spongebob-squarepants', 'SpongeBob', 'SquarePants',
   'I am ready! Fades, lineups, and kids cuts, seven days a week. Ask me about the bubble finish -- it is free and it is the best part.',
   'spongebob@krustyfadez.test', '+16925550102',
   'https://images.bookmeup.test/workers/spongebob.jpg', true,
   24, true, 30, 60, 120),

  ('00000003-0000-4000-8000-000000000003', '00000001-0000-4000-8000-000000000003',
   'patrick-star', 'Patrick', 'Star',
   'I cut hair. Sometimes. Book early, or late, it is all the same to me. Naps included at no extra charge.',
   'patrick@krustyfadez.test', '+16925550103',
   null, true,
   24, true, 240, 14, 60),      -- can't plan more than two weeks out

  ('00000003-0000-4000-8000-000000000004', '00000001-0000-4000-8000-000000000004',
   'squidward-tentacles', 'Squidward', 'Tentacles',
   'Tattoo artist. Fine line, blackwork, and classical portraiture. No, I will not tattoo a pineapple. Consultations are required and, unfortunately, free.',
   'squidward@krustyfadez.test', '+16925550104',
   'https://images.bookmeup.test/workers/squidward.jpg', true,
   72, false, 1440, 180, 2880), -- day of lead time, 48h cancellation window

  ('00000003-0000-4000-8000-000000000005', '00000001-0000-4000-8000-000000000005',
   'sandy-cheeks', 'Sandy', 'Cheeks',
   'Nail tech and materials scientist. Gel sets engineered to survive karate practice. Y''all come back now.',
   'sandy@krustyfadez.test', '+16925550105',
   'https://images.bookmeup.test/workers/sandy.jpg', true,
   24, true, 60, 45, 180),

  -- ---- Regular Cutz ----------------------------------------------------------
  ('00000003-0000-4000-8000-000000000006', '00000001-0000-4000-8000-000000000006',
   'benson-dunwoody', 'Benson', 'Dunwoody',
   'Owner and head barber. Show up on time, sit still, and nobody gets fired. Twelve hours to confirm your hold, then it is gone.',
   'benson@regularcutz.test', '+18185550106',
   'https://images.bookmeup.test/workers/benson.jpg', true,
   12, false, 120, 60, 720),

  ('00000003-0000-4000-8000-000000000007', '00000001-0000-4000-8000-000000000007',
   'mordecai-jay', 'Mordecai', 'Jay',
   'Fades and cleanups, evenings mostly. If the chair is empty I am probably next door getting coffee -- text me and I will be right back.',
   'mordecai@regularcutz.test', '+18185550107',
   'https://images.bookmeup.test/workers/mordecai.jpg', true,
   24, true, 60, 45, 240),

  ('00000003-0000-4000-8000-000000000008', '00000001-0000-4000-8000-000000000008',
   'rigby-raccoon', 'Rigby', 'Raccoon',
   'Fastest lineup in the park. Do not book me more than a week out, I will forget. Cancel whenever, I honestly do not mind.',
   'rigby@regularcutz.test', '+18185550108',
   null, true,
   24, true, 15, 7, 30),        -- 7 days max advance, 30 min cancellation cutoff

  ('00000003-0000-4000-8000-000000000009', '00000001-0000-4000-8000-000000000009',
   'skips-yeti', 'Skips', 'Yeti',
   'Been cutting hair a very long time. Two shops, one price list. Walk in whenever -- I already knew you were coming.',
   'skips@regularcutz.test', '+18185550109',
   'https://images.bookmeup.test/workers/skips.jpg', true,
   24, true, 0, 120, 0),        -- zero lead time, cancel right up to the minute

  ('00000003-0000-4000-8000-000000000010', '00000001-0000-4000-8000-000000000010',
   'pops-maellard', 'Pops', 'Maellard',
   'Good show! A gentleman''s cut, a hot towel, and a lollipop on the way out. Book as far ahead as you like, jolly good.',
   'pops@regularcutz.test', '+18185550110',
   'https://images.bookmeup.test/workers/pops.jpg', true,
   24, true, 180, 365, 60);     -- happily takes bookings a year out


-- -----------------------------------------------------------------------------
-- 6. WORKER ESTABLISHMENTS -- "the chair"
--
-- Note row 11: Skips holds an ACTIVE chair at BOTH shops. His services and
-- booking policy are identical in both places (they hang off worker_profile),
-- but his hours differ per chair, and his time off blocks both.
-- -----------------------------------------------------------------------------

insert into public.worker_establishment (id, worker_id, establishment_id, is_active, started_at)
values
  -- Krusty Fadez
  ('00000004-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001', true, now() - interval '12 years'),
  ('00000004-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', true, now() - interval '9 years'),
  ('00000004-0000-4000-8000-000000000003', '00000003-0000-4000-8000-000000000003', '00000002-0000-4000-8000-000000000001', true, now() - interval '4 years'),
  ('00000004-0000-4000-8000-000000000004', '00000003-0000-4000-8000-000000000004', '00000002-0000-4000-8000-000000000001', true, now() - interval '9 years'),
  ('00000004-0000-4000-8000-000000000005', '00000003-0000-4000-8000-000000000005', '00000002-0000-4000-8000-000000000001', true, now() - interval '6 years'),
  -- Regular Cutz
  ('00000004-0000-4000-8000-000000000006', '00000003-0000-4000-8000-000000000006', '00000002-0000-4000-8000-000000000002', true, now() - interval '8 years'),
  ('00000004-0000-4000-8000-000000000007', '00000003-0000-4000-8000-000000000007', '00000002-0000-4000-8000-000000000002', true, now() - interval '5 years'),
  ('00000004-0000-4000-8000-000000000008', '00000003-0000-4000-8000-000000000008', '00000002-0000-4000-8000-000000000002', true, now() - interval '5 years'),
  ('00000004-0000-4000-8000-000000000009', '00000003-0000-4000-8000-000000000009', '00000002-0000-4000-8000-000000000002', true, now() - interval '30 years'),
  ('00000004-0000-4000-8000-000000000010', '00000003-0000-4000-8000-000000000010', '00000002-0000-4000-8000-000000000002', true, now() - interval '20 years'),
  -- Skips' second chair, 21 timezones away
  ('00000004-0000-4000-8000-000000000011', '00000003-0000-4000-8000-000000000009', '00000002-0000-4000-8000-000000000001', true, now() - interval '2 years');


-- -----------------------------------------------------------------------------
-- 7. SCHEDULE DAYS  (minutes 0-1440, LOCAL to each establishment's timezone)
--
-- dow: 0 = Sunday ... 6 = Saturday
-- Skips is the interesting one: Mon/Tue mornings at Krusty Fadez (chair 11) and
-- Thu/Fri/Sat at Regular Cutz (chair 09) -- different hours, same person.
-- -----------------------------------------------------------------------------

insert into public.worker_schedule_day
  (id, worker_establishment_id, day_of_week, start_minute, end_minute, break_start_minute, break_end_minute)
select gen_random_uuid(), v.we, v.dow, v.s, v.e, v.bs, v.be
from (values
  -- Mr. Krabs @ Krusty Fadez -- Mon-Sat 08:00-20:00, no break, ever
  ('00000004-0000-4000-8000-000000000001'::uuid, 1, 480, 1200, null::int, null::int),
  ('00000004-0000-4000-8000-000000000001'::uuid, 2, 480, 1200, null,      null),
  ('00000004-0000-4000-8000-000000000001'::uuid, 3, 480, 1200, null,      null),
  ('00000004-0000-4000-8000-000000000001'::uuid, 4, 480, 1200, null,      null),
  ('00000004-0000-4000-8000-000000000001'::uuid, 5, 480, 1200, null,      null),
  ('00000004-0000-4000-8000-000000000001'::uuid, 6, 480, 1200, null,      null),

  -- SpongeBob @ Krusty Fadez -- every single day, 09:00-19:00, lunch 13:00-14:00
  ('00000004-0000-4000-8000-000000000002'::uuid, 0, 600,  960, null,      null),   -- short Sunday
  ('00000004-0000-4000-8000-000000000002'::uuid, 1, 540, 1140, 780,       840),
  ('00000004-0000-4000-8000-000000000002'::uuid, 2, 540, 1140, 780,       840),
  ('00000004-0000-4000-8000-000000000002'::uuid, 3, 540, 1140, 780,       840),
  ('00000004-0000-4000-8000-000000000002'::uuid, 4, 540, 1140, 780,       840),
  ('00000004-0000-4000-8000-000000000002'::uuid, 5, 540, 1140, 780,       840),
  ('00000004-0000-4000-8000-000000000002'::uuid, 6, 540, 1140, 780,       840),

  -- Patrick @ Krusty Fadez -- Wed/Fri/Sat 11:00-17:00, two-hour "break"
  ('00000004-0000-4000-8000-000000000003'::uuid, 3, 660, 1020, 780,       900),
  ('00000004-0000-4000-8000-000000000003'::uuid, 5, 660, 1020, 780,       900),
  ('00000004-0000-4000-8000-000000000003'::uuid, 6, 660, 1020, 780,       900),

  -- Squidward @ Krusty Fadez -- Tue/Wed/Thu 10:00-18:00, lunch 12:00-13:00
  ('00000004-0000-4000-8000-000000000004'::uuid, 2, 600, 1080, 720,       780),
  ('00000004-0000-4000-8000-000000000004'::uuid, 3, 600, 1080, 720,       780),
  ('00000004-0000-4000-8000-000000000004'::uuid, 4, 600, 1080, 720,       780),

  -- Sandy @ Krusty Fadez -- Mon/Wed/Fri/Sat 08:00-17:00, lunch 12:00-13:00
  ('00000004-0000-4000-8000-000000000005'::uuid, 1, 480, 1020, 720,       780),
  ('00000004-0000-4000-8000-000000000005'::uuid, 3, 480, 1020, 720,       780),
  ('00000004-0000-4000-8000-000000000005'::uuid, 5, 480, 1020, 720,       780),
  ('00000004-0000-4000-8000-000000000005'::uuid, 6, 480, 1020, 720,       780),

  -- Skips @ Krusty Fadez -- Mon/Tue mornings only, 07:00-13:00
  ('00000004-0000-4000-8000-000000000011'::uuid, 1, 420,  780, null,      null),
  ('00000004-0000-4000-8000-000000000011'::uuid, 2, 420,  780, null,      null),

  -- Benson @ Regular Cutz -- Tue-Sat 09:00-18:00, lunch 13:00-14:00
  ('00000004-0000-4000-8000-000000000006'::uuid, 2, 540, 1080, 780,       840),
  ('00000004-0000-4000-8000-000000000006'::uuid, 3, 540, 1080, 780,       840),
  ('00000004-0000-4000-8000-000000000006'::uuid, 4, 540, 1080, 780,       840),
  ('00000004-0000-4000-8000-000000000006'::uuid, 5, 540, 1080, 780,       840),
  ('00000004-0000-4000-8000-000000000006'::uuid, 6, 540, 1080, 780,       840),

  -- Mordecai @ Regular Cutz -- Tue-Sat 11:00-20:00, break 15:00-16:00
  ('00000004-0000-4000-8000-000000000007'::uuid, 2, 660, 1200, 900,       960),
  ('00000004-0000-4000-8000-000000000007'::uuid, 3, 660, 1200, 900,       960),
  ('00000004-0000-4000-8000-000000000007'::uuid, 4, 660, 1200, 900,       960),
  ('00000004-0000-4000-8000-000000000007'::uuid, 5, 660, 1200, 900,       960),
  ('00000004-0000-4000-8000-000000000007'::uuid, 6, 660, 1200, 900,       960),

  -- Rigby @ Regular Cutz -- Thu/Fri/Sat 12:00-20:00, break 16:00-17:00
  ('00000004-0000-4000-8000-000000000008'::uuid, 4, 720, 1200, 960,      1020),
  ('00000004-0000-4000-8000-000000000008'::uuid, 5, 720, 1200, 960,      1020),
  ('00000004-0000-4000-8000-000000000008'::uuid, 6, 720, 1200, 960,      1020),

  -- Skips @ Regular Cutz -- Thu/Fri/Sat 08:00-16:00, no break
  ('00000004-0000-4000-8000-000000000009'::uuid, 4, 480,  960, null,      null),
  ('00000004-0000-4000-8000-000000000009'::uuid, 5, 480,  960, null,      null),
  ('00000004-0000-4000-8000-000000000009'::uuid, 6, 480,  960, null,      null),

  -- Pops @ Regular Cutz -- Tue/Wed/Fri 10:00-15:00
  ('00000004-0000-4000-8000-000000000010'::uuid, 2, 600,  900, null,      null),
  ('00000004-0000-4000-8000-000000000010'::uuid, 3, 600,  900, null,      null),
  ('00000004-0000-4000-8000-000000000010'::uuid, 5, 600,  900, null,      null)
) as v(we, dow, s, e, bs, be);


-- -----------------------------------------------------------------------------
-- 8. SERVICES  (owned by the WORKER, not the shop -- the menu travels)
--
-- buffer_after_min is the barber-only cleanup tail. Patrick's is enormous
-- because he is Patrick; Skips' Immortal Buzz has none because he is Skips.
--
-- Service 07 is INACTIVE. A past appointment still references it -- see A011.
-- -----------------------------------------------------------------------------

insert into public.service (id, worker_id, title, description, price_cents, duration_min, buffer_after_min, is_active)
values
  -- Mr. Krabs
  ('00000005-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', 'The Money Trim',              'Quick, clean, and priced to the penny. No conversation included.',                    1500,  25,  5, true),
  ('00000005-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000001', 'First Mate Fade',             'Skin fade with a hard part. The one he actually takes his time on.',                 2200,  35, 10, true),
  -- SpongeBob
  ('00000005-0000-4000-8000-000000000003', '00000003-0000-4000-8000-000000000002', 'The Bubble Fade',             'Mid fade, textured top, finished with the bubble treatment. House specialty.',       2500,  45, 15, true),
  ('00000005-0000-4000-8000-000000000004', '00000003-0000-4000-8000-000000000002', 'Jellyfish Lineup',            'Edge-up and beard detail. In and out before the net dries.',                          1200,  20,  5, true),
  ('00000005-0000-4000-8000-000000000005', '00000003-0000-4000-8000-000000000002', 'Krusty Kids Cut',             'For under-twelves. Includes a balloon and unlimited enthusiasm.',                     1800,  30, 10, true),
  -- Patrick
  ('00000005-0000-4000-8000-000000000006', '00000003-0000-4000-8000-000000000003', 'Rock Bottom Buzz',            'One guard, all over. Genuinely hard to get wrong.',                                   1000,  25, 20, true),
  ('00000005-0000-4000-8000-000000000007', '00000003-0000-4000-8000-000000000003', 'Under-the-Rock Nap and Trim', 'A trim, eventually. Discontinued after the incident.',                                1500,  60, 30, false),
  -- Squidward (tattoos)
  ('00000005-0000-4000-8000-000000000008', '00000003-0000-4000-8000-000000000004', 'Clarinet Flash Tattoo',       'Palm-sized fine-line piece from the flash book. Placement discussed, not debated.',  12000,  90, 30, true),
  ('00000005-0000-4000-8000-000000000009', '00000003-0000-4000-8000-000000000004', 'Ink Consultation',            'Thirty minutes to explain why your idea will not work. Free, regrettably.',              0,  30, 15, true),
  ('00000005-0000-4000-8000-000000000010', '00000003-0000-4000-8000-000000000004', 'Half-Sleeve Session',         'Four-hour blackwork sitting. Deposit non-refundable. Do not eat beforehand.',        40000, 240, 45, true),
  -- Sandy (nails)
  ('00000005-0000-4000-8000-000000000011', '00000003-0000-4000-8000-000000000005', 'Texas Gel Set',               'Full gel set, reinforced. Field-tested against a cinder block.',                      5500,  75, 15, true),
  ('00000005-0000-4000-8000-000000000012', '00000003-0000-4000-8000-000000000005', 'Karate Chop Manicure',        'Shape, cuticle work, and a matte finish. Short by design.',                           3500,  45, 10, true),
  ('00000005-0000-4000-8000-000000000013', '00000003-0000-4000-8000-000000000005', 'Science Fair Nail Art',       'Hand-painted, two accent nails, chrome topcoat. Bring a reference photo.',            7000,  90, 20, true),
  -- Benson
  ('00000005-0000-4000-8000-000000000014', '00000003-0000-4000-8000-000000000006', 'The Gumball Fade',            'Tight taper, sharp line. Come in clean or come back later.',                          3000,  40, 10, true),
  ('00000005-0000-4000-8000-000000000015', '00000003-0000-4000-8000-000000000006', 'You Are Fired Buzz',          'Number two all over. Twenty minutes, no negotiation.',                                1800,  20,  5, true),
  -- Mordecai
  ('00000005-0000-4000-8000-000000000016', '00000003-0000-4000-8000-000000000007', 'Blue Jay Fade',               'Low fade with a lot of texture on top. His best work, honestly.',                     2800,  40, 10, true),
  ('00000005-0000-4000-8000-000000000017', '00000003-0000-4000-8000-000000000007', 'Coffee Shop Cleanup',         'Neckline, edges, and a quick scissor tidy. Great between real cuts.',                 2000,  25,  5, true),
  -- Rigby
  ('00000005-0000-4000-8000-000000000018', '00000003-0000-4000-8000-000000000008', 'Trash Panda Trim',            'Scissor cut, layered. Takes longer to clean up than to cut.',                         1500,  30, 25, true),
  ('00000005-0000-4000-8000-000000000019', '00000003-0000-4000-8000-000000000008', 'Death Punch Lineup',          'Fifteen-minute edge-up. Fastest in the park, allegedly.',                             1000,  15, 10, true),
  -- Skips (same menu at both shops)
  ('00000005-0000-4000-8000-000000000020', '00000003-0000-4000-8000-000000000009', 'The Immortal Buzz',           'Single-guard buzz. No buffer needed -- the station is clean before you stand up.',    3500,  30,  0, true),
  ('00000005-0000-4000-8000-000000000021', '00000003-0000-4000-8000-000000000009', 'Fixes-Everything Fade',       'Whatever the last barber did, he will fix it. Bring the photo.',                      4000,  35,  5, true),
  -- Pops
  ('00000005-0000-4000-8000-000000000022', '00000003-0000-4000-8000-000000000010', 'Lollipop Lineup',             'A tidy-up and a hot towel. Lollipop on the way out, naturally.',                      2200,  35, 10, true),
  ('00000005-0000-4000-8000-000000000023', '00000003-0000-4000-8000-000000000010', 'Good Show Gentlemans Cut',    'Scissor cut, straight-razor neck, hot towel, and a proper conversation.',             4500,  60, 15, true);


-- -----------------------------------------------------------------------------
-- 9. TIME OFF  (scoped to the PERSON -- blocks every shop they work)
-- -----------------------------------------------------------------------------

insert into public.worker_time_off (id, worker_id, starts, ends, reason)
values
  -- Skips is out all of week +3. This removes him from Regular Cutz AND from
  -- Krusty Fadez, because time off hangs off worker_id, not the chair.
  ('00000009-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000009',
   pg_temp.rc(3, 1, '00:00'), pg_temp.rc(3, 6, '23:59'),
   'Out of town. Do not touch the cart.'),

  -- SpongeBob takes a single Thursday
  ('00000009-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000002',
   pg_temp.kf(2, 4, '00:00'), pg_temp.kf(2, 5, '00:00'),
   'Jellyfishing with Patrick.'),

  -- historical, already elapsed
  ('00000009-0000-4000-8000-000000000003', '00000003-0000-4000-8000-000000000004',
   pg_temp.kf(-2, 5, '00:00'), pg_temp.kf(-2, 6, '18:00'),
   'Clarinet recital. Nobody came.');


-- -----------------------------------------------------------------------------
-- 10. CLIENTS
--
-- Client identity is deliberately soft. Two things being demonstrated:
--   * clients 01 and 02 share ONE phone number -- Plankton books for Karen too.
--     client.phone is the dedupe key but is NOT unique, on purpose.
--   * only Plankton and Muscle Man ever signed up (user_id set). Everyone else
--     exists purely because a barber booked them.
--   * Gary and Mr. Maellard have NO client row at all -- they book as guests.
-- -----------------------------------------------------------------------------

insert into public.client (id, phone, email, display_name, user_id)
values
  -- Krusty Fadez regulars
  ('00000006-0000-4000-8000-000000000001', '+16925552001', 'plankton@bikinibottom.test',  'Sheldon Plankton',   '00000001-0000-4000-8000-000000000011'),
  ('00000006-0000-4000-8000-000000000002', '+16925552001', 'karen@bikinibottom.test',     'Karen Plankton',     '00000001-0000-4000-8000-000000000011'),  -- same phone, same account
  ('00000006-0000-4000-8000-000000000003', '+16925552003', 'pearl@bikinibottom.test',     'Pearl Krabs',        null),
  ('00000006-0000-4000-8000-000000000004', '+16925552004', null,                          'Mrs. Puff',          null),
  ('00000006-0000-4000-8000-000000000005', '+16925552005', 'larry@bikinibottom.test',     'Larry the Lobster',  null),
  ('00000006-0000-4000-8000-000000000006', '+16925552006', null,                          'Bubble Bass',        null),
  ('00000006-0000-4000-8000-000000000007', '+16925552007', 'squilliam@bikinibottom.test', 'Squilliam Fancyson', null),
  -- Regular Cutz regulars
  ('00000006-0000-4000-8000-000000000008', '+18185552008', 'muscleman@twinpeaks.test',    'Muscle Man',         '00000001-0000-4000-8000-000000000012'),
  ('00000006-0000-4000-8000-000000000009', '+18185552009', null,                          'Hi-Five Ghost',      null),
  ('00000006-0000-4000-8000-000000000010', '+18185552010', 'margaret@twinpeaks.test',     'Margaret Smith',     null),
  ('00000006-0000-4000-8000-000000000011', '+18185552011', 'eileen@twinpeaks.test',       'Eileen Roberts',     null),
  ('00000006-0000-4000-8000-000000000012', '+18185552012', null,                          'Thomas',             null),
  ('00000006-0000-4000-8000-000000000013', '+18185552013', 'cj@twinpeaks.test',           'CJ',                 null);


-- -----------------------------------------------------------------------------
-- 11. CLIENT NOTES  (barber-authored, PRIVATE to that worker -- never shown to
--     the client, and never visible to another barber)
--
-- Note 07 has a NULL client_id: Mr. Maellard only ever books as a guest, so the
-- note is soft-linked by phone alone.
-- -----------------------------------------------------------------------------

insert into public.client_note (id, client_id, client_phone, client_email, worker_id, body)
values
  ('00000008-0000-4000-8000-000000000001', '00000006-0000-4000-8000-000000000006', '+16925552006', null,
   '00000003-0000-4000-8000-000000000002',
   'Talks a big game about the fade and then asks for the same lineup. Quote the full price up front.'),

  ('00000008-0000-4000-8000-000000000002', '00000006-0000-4000-8000-000000000003', '+16925552003', 'pearl@bikinibottom.test',
   '00000003-0000-4000-8000-000000000002',
   'Allergic to the blue bubble solution. Use the plain one -- she will not notice, do not tell her.'),

  ('00000008-0000-4000-8000-000000000003', '00000006-0000-4000-8000-000000000007', '+16925552007', 'squilliam@bikinibottom.test',
   '00000003-0000-4000-8000-000000000004',
   'Wants the half-sleeve finished before the reunion. Under no circumstances book him another free consult.'),

  ('00000008-0000-4000-8000-000000000004', '00000006-0000-4000-8000-000000000002', '+16925552001', 'karen@bikinibottom.test',
   '00000003-0000-4000-8000-000000000005',
   'Chrome finish only. Anything matte and she reboots. Books on her husband''s number.'),

  ('00000008-0000-4000-8000-000000000005', '00000006-0000-4000-8000-000000000008', '+18185552008', 'muscleman@twinpeaks.test',
   '00000003-0000-4000-8000-000000000008',
   'No-showed twice this month. Take a deposit or do not take the booking.'),

  ('00000008-0000-4000-8000-000000000006', '00000006-0000-4000-8000-000000000012', '+18185552012', null,
   '00000003-0000-4000-8000-000000000006',
   'Intern rate. Do not mention it to the others, and do not put it on the board.'),

  ('00000008-0000-4000-8000-000000000007', null, '+18185552098', null,
   '00000003-0000-4000-8000-000000000010',
   'Father. Books as a guest on purpose so it does not look like favouritism. Never charge him.');


-- -----------------------------------------------------------------------------
-- 12. APPOINTMENTS
--
-- Three things worth knowing before you read these:
--
--  1. ends_at and block_ends_at are NOT set here. The appointment_set_times()
--     BEFORE INSERT trigger computes them:
--         ends_at       = starts_at + duration_min      (what the client sees)
--         block_ends_at = ends_at   + buffer_after_min  (what the barber sees)
--     Setting them by hand would just be overwritten.
--
--  2. service_title / price_cents / duration_min / buffer_after_min are
--     SNAPSHOTS taken at booking time, not joins. A001, A019 and A030 carry
--     prices that no longer match the live service row, and A011 points at a
--     service that has since been deactivated. That is correct and intentional:
--     never join service to display an appointment.
--
--  3. appointment_no_double_booking is a GiST exclusion constraint over
--     (worker_id, [starts_at, block_ends_at)) for PENDING and ACCEPTED rows
--     ONLY -- and it spans shops, so Skips cannot be double-booked across both.
--     Past rows are all COMPLETED / NO_SHOW / CANCELLED / REJECTED, so they are
--     exempt and can sit wherever they like.
--
-- cancelled_at / cancelled_by / cancellation_reason must ALL be null unless the
-- status is CANCELLED or REJECTED. hold_expires_at is only legal while PENDING.
-- -----------------------------------------------------------------------------

insert into public.appointment
  (id, worker_establishment_id, establishment_id, worker_id, service_id, client_id,
   starts_at, service_title, price_cents, duration_min, buffer_after_min,
   status, cancelled_by, cancelled_at, cancellation_reason, hold_expires_at,
   client_name, client_phone, client_email, client_notes)
values

-- ============================ KRUSTY FADEZ ==================================

-- ---- SpongeBob (chair 02) --------------------------------------------------
-- A001  history. Snapshot price is 2200; the live service is now 2500.
('00000007-0000-4000-8000-000000000001', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000003', '00000006-0000-4000-8000-000000000003',
 pg_temp.kf(-2, 3, '10:00'), 'The Bubble Fade', 2200, 45, 15,
 'COMPLETED', null, null, null, null,
 'Pearl Krabs', '+16925552003', 'pearl@bikinibottom.test', null),

-- A002
('00000007-0000-4000-8000-000000000002', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000004', '00000006-0000-4000-8000-000000000006',
 pg_temp.kf(-1, 5, '15:30'), 'Jellyfish Lineup', 1200, 20, 5,
 'NO_SHOW', null, null, null, null,
 'Bubble Bass', '+16925552006', null, null),

-- A003
('00000007-0000-4000-8000-000000000003', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000003', '00000006-0000-4000-8000-000000000005',
 pg_temp.kf(-1, 2, '11:00'), 'The Bubble Fade', 2500, 45, 15,
 'COMPLETED', null, null, null, null,
 'Larry the Lobster', '+16925552005', 'larry@bikinibottom.test', 'Same as last time, but shorter on the sides.'),

-- A004  client backed out in time
('00000007-0000-4000-8000-000000000004', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000005', '00000006-0000-4000-8000-000000000004',
 pg_temp.kf(-3, 4, '09:30'), 'Krusty Kids Cut', 1800, 30, 10,
 'CANCELLED', 'CLIENT', now() - interval '22 days', 'Boating school exam got rescheduled.', null,
 'Mrs. Puff', '+16925552004', null, null),

-- A005  upcoming, auto-accepted
('00000007-0000-4000-8000-000000000005', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000003', '00000006-0000-4000-8000-000000000003',
 pg_temp.kf(1, 3, '14:30'), 'The Bubble Fade', 2500, 45, 15,
 'ACCEPTED', null, null, null, null,
 'Pearl Krabs', '+16925552003', 'pearl@bikinibottom.test', 'Extra bubbles please!!'),

-- A006  GUEST booking -- no client row exists, resolved by phone alone
('00000007-0000-4000-8000-000000000006', '00000004-0000-4000-8000-000000000002', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000002', '00000005-0000-4000-8000-000000000004', null,
 pg_temp.kf(1, 6, '11:00'), 'Jellyfish Lineup', 1200, 20, 5,
 'ACCEPTED', null, null, null, null,
 'Gary', '+16925552099', null, 'Meow.'),

-- ---- Mr. Krabs (chair 01) -- auto_accept = false, so new bookings sit PENDING
-- A007
('00000007-0000-4000-8000-000000000007', '00000004-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', '00000005-0000-4000-8000-000000000002', '00000006-0000-4000-8000-000000000007',
 pg_temp.kf(-2, 1, '08:30'), 'First Mate Fade', 2200, 35, 10,
 'COMPLETED', null, null, null, null,
 'Squilliam Fancyson', '+16925552007', 'squilliam@bikinibottom.test', null),

-- A008  the expired-hold sweep: PENDING -> CANCELLED by SYSTEM. Note that
--       hold_expires_at is cleared on the transition, as the sweeper does.
('00000007-0000-4000-8000-000000000008', '00000004-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', '00000005-0000-4000-8000-000000000001', '00000006-0000-4000-8000-000000000001',
 pg_temp.kf(-1, 4, '16:00'), 'The Money Trim', 1500, 25, 5,
 'CANCELLED', 'SYSTEM', now() - interval '9 days', 'Hold expired without a response', null,
 'Sheldon Plankton', '+16925552001', 'plankton@bikinibottom.test', 'I only need one hair.'),

-- A009  live hold, awaiting his approval
('00000007-0000-4000-8000-000000000009', '00000004-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', '00000005-0000-4000-8000-000000000001', '00000006-0000-4000-8000-000000000003',
 pg_temp.kf(1, 2, '09:00'), 'The Money Trim', 1500, 25, 5,
 'PENDING', null, null, null, now() + interval '48 hours',
 'Pearl Krabs', '+16925552003', 'pearl@bikinibottom.test', 'Daaaad.'),

-- A010
('00000007-0000-4000-8000-000000000010', '00000004-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000001', '00000005-0000-4000-8000-000000000002', '00000006-0000-4000-8000-000000000005',
 pg_temp.kf(2, 5, '17:00'), 'First Mate Fade', 2200, 35, 10,
 'PENDING', null, null, null, now() + interval '48 hours',
 'Larry the Lobster', '+16925552005', 'larry@bikinibottom.test', null),

-- ---- Patrick (chair 03) ----------------------------------------------------
-- A011  points at service 07, which is now INACTIVE. The snapshot still renders.
('00000007-0000-4000-8000-000000000011', '00000004-0000-4000-8000-000000000003', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000003', '00000005-0000-4000-8000-000000000007', '00000006-0000-4000-8000-000000000006',
 pg_temp.kf(-2, 6, '11:30'), 'Under-the-Rock Nap and Trim', 1500, 60, 30,
 'COMPLETED', null, null, null, null,
 'Bubble Bass', '+16925552006', null, null),

-- A012
('00000007-0000-4000-8000-000000000012', '00000004-0000-4000-8000-000000000003', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000003', '00000005-0000-4000-8000-000000000006', '00000006-0000-4000-8000-000000000007',
 pg_temp.kf(-1, 3, '15:30'), 'Rock Bottom Buzz', 1000, 25, 20,
 'NO_SHOW', null, null, null, null,
 'Squilliam Fancyson', '+16925552007', 'squilliam@bikinibottom.test', null),

-- A013
('00000007-0000-4000-8000-000000000013', '00000004-0000-4000-8000-000000000003', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000003', '00000005-0000-4000-8000-000000000006', '00000006-0000-4000-8000-000000000004',
 pg_temp.kf(1, 5, '11:00'), 'Rock Bottom Buzz', 1000, 25, 20,
 'ACCEPTED', null, null, null, null,
 'Mrs. Puff', '+16925552004', null, null),

-- A014
('00000007-0000-4000-8000-000000000014', '00000004-0000-4000-8000-000000000003', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000003', '00000005-0000-4000-8000-000000000006', '00000006-0000-4000-8000-000000000005',
 pg_temp.kf(2, 6, '16:00'), 'Rock Bottom Buzz', 1000, 25, 20,
 'ACCEPTED', null, null, null, null,
 'Larry the Lobster', '+16925552005', 'larry@bikinibottom.test', null),

-- ---- Squidward (chair 04) -- tattoos, auto_accept = false -------------------
-- A015  four-hour sitting: 13:00 -> 17:00, plus 45 min of buffer
('00000007-0000-4000-8000-000000000015', '00000004-0000-4000-8000-000000000004', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000004', '00000005-0000-4000-8000-000000000010', '00000006-0000-4000-8000-000000000007',
 pg_temp.kf(-2, 3, '13:00'), 'Half-Sleeve Session', 40000, 240, 45,
 'COMPLETED', null, null, null, null,
 'Squilliam Fancyson', '+16925552007', 'squilliam@bikinibottom.test', 'Something classical. Tasteful. Expensive.'),

-- A016  the barber said no
('00000007-0000-4000-8000-000000000016', '00000004-0000-4000-8000-000000000004', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000004', '00000005-0000-4000-8000-000000000009', '00000006-0000-4000-8000-000000000006',
 pg_temp.kf(-1, 2, '10:00'), 'Ink Consultation', 0, 30, 15,
 'REJECTED', 'WORKER', now() - interval '11 days', 'Not enough available skin for that concept.', null,
 'Bubble Bass', '+16925552006', null, 'Full back piece. Krabby Patty themed.'),

-- A017
('00000007-0000-4000-8000-000000000017', '00000004-0000-4000-8000-000000000004', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000004', '00000005-0000-4000-8000-000000000008', '00000006-0000-4000-8000-000000000001',
 pg_temp.kf(1, 4, '10:00'), 'Clarinet Flash Tattoo', 12000, 90, 30,
 'PENDING', null, null, null, now() + interval '72 hours',
 'Sheldon Plankton', '+16925552001', 'plankton@bikinibottom.test', 'Very small. I am very small.'),

-- A018
('00000007-0000-4000-8000-000000000018', '00000004-0000-4000-8000-000000000004', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000004', '00000005-0000-4000-8000-000000000009', '00000006-0000-4000-8000-000000000002',
 pg_temp.kf(2, 2, '14:00'), 'Ink Consultation', 0, 30, 15,
 'PENDING', null, null, null, now() + interval '72 hours',
 'Karen Plankton', '+16925552001', 'karen@bikinibottom.test', null),

-- ---- Sandy (chair 05) -- nails ---------------------------------------------
-- A019  snapshot price 6500; the live service is now 7000
('00000007-0000-4000-8000-000000000019', '00000004-0000-4000-8000-000000000005', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000005', '00000005-0000-4000-8000-000000000013', '00000006-0000-4000-8000-000000000003',
 pg_temp.kf(-1, 6, '09:00'), 'Science Fair Nail Art', 6500, 90, 20,
 'COMPLETED', null, null, null, null,
 'Pearl Krabs', '+16925552003', 'pearl@bikinibottom.test', null),

-- A020
('00000007-0000-4000-8000-000000000020', '00000004-0000-4000-8000-000000000005', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000005', '00000005-0000-4000-8000-000000000012', '00000006-0000-4000-8000-000000000004',
 pg_temp.kf(-2, 3, '13:30'), 'Karate Chop Manicure', 3500, 45, 10,
 'COMPLETED', null, null, null, null,
 'Mrs. Puff', '+16925552004', null, null),

-- A021
('00000007-0000-4000-8000-000000000021', '00000004-0000-4000-8000-000000000005', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000005', '00000005-0000-4000-8000-000000000011', '00000006-0000-4000-8000-000000000002',
 pg_temp.kf(1, 1, '08:30'), 'Texas Gel Set', 5500, 75, 15,
 'ACCEPTED', null, null, null, null,
 'Karen Plankton', '+16925552001', 'karen@bikinibottom.test', 'Chrome. Always chrome.'),

-- A022
('00000007-0000-4000-8000-000000000022', '00000004-0000-4000-8000-000000000005', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000005', '00000005-0000-4000-8000-000000000013', '00000006-0000-4000-8000-000000000003',
 pg_temp.kf(2, 3, '15:00'), 'Science Fair Nail Art', 7000, 90, 20,
 'ACCEPTED', null, null, null, null,
 'Pearl Krabs', '+16925552003', 'pearl@bikinibottom.test', null),

-- ---- Skips at KRUSTY FADEZ (chair 11) -- his second shop --------------------
-- A023
('00000007-0000-4000-8000-000000000023', '00000004-0000-4000-8000-000000000011', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000009', '00000005-0000-4000-8000-000000000020', '00000006-0000-4000-8000-000000000005',
 pg_temp.kf(-1, 1, '07:30'), 'The Immortal Buzz', 3500, 30, 0,
 'COMPLETED', null, null, null, null,
 'Larry the Lobster', '+16925552005', 'larry@bikinibottom.test', null),

-- A024  Krusty Fadez local time. Compare with A037, same week, same barber,
--       other shop, 21 hours of offset away.
('00000007-0000-4000-8000-000000000024', '00000004-0000-4000-8000-000000000011', '00000002-0000-4000-8000-000000000001', '00000003-0000-4000-8000-000000000009', '00000005-0000-4000-8000-000000000021', '00000006-0000-4000-8000-000000000001',
 pg_temp.kf(1, 2, '08:00'), 'Fixes-Everything Fade', 4000, 35, 5,
 'ACCEPTED', null, null, null, null,
 'Sheldon Plankton', '+16925552001', 'plankton@bikinibottom.test', 'The last guy ruined it.'),


-- ============================ REGULAR CUTZ ==================================

-- ---- Benson (chair 06) -- auto_accept = false, 12 hour holds ----------------
-- A025
('00000007-0000-4000-8000-000000000025', '00000004-0000-4000-8000-000000000006', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000006', '00000005-0000-4000-8000-000000000015', '00000006-0000-4000-8000-000000000008',
 pg_temp.rc(-2, 4, '09:00'), 'You Are Fired Buzz', 1800, 20, 5,
 'COMPLETED', null, null, null, null,
 'Muscle Man', '+18185552008', 'muscleman@twinpeaks.test', 'You know who else needs a haircut'),

-- A026  shop-side cancellation
('00000007-0000-4000-8000-000000000026', '00000004-0000-4000-8000-000000000006', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000006', '00000005-0000-4000-8000-000000000014', '00000006-0000-4000-8000-000000000012',
 pg_temp.rc(-1, 5, '11:00'), 'The Gumball Fade', 3000, 40, 10,
 'CANCELLED', 'WORKER', now() - interval '8 days', 'Shop closed early for a cart emergency.', null,
 'Thomas', '+18185552012', null, null),

-- A027
('00000007-0000-4000-8000-000000000027', '00000004-0000-4000-8000-000000000006', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000006', '00000005-0000-4000-8000-000000000014', '00000006-0000-4000-8000-000000000010',
 pg_temp.rc(1, 3, '10:00'), 'The Gumball Fade', 3000, 40, 10,
 'PENDING', null, null, null, now() + interval '12 hours',
 'Margaret Smith', '+18185552010', 'margaret@twinpeaks.test', null),

-- A028
('00000007-0000-4000-8000-000000000028', '00000004-0000-4000-8000-000000000006', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000006', '00000005-0000-4000-8000-000000000015', '00000006-0000-4000-8000-000000000009',
 pg_temp.rc(2, 6, '15:00'), 'You Are Fired Buzz', 1800, 20, 5,
 'PENDING', null, null, null, now() + interval '12 hours',
 'Hi-Five Ghost', '+18185552009', null, null),

-- ---- Mordecai (chair 07) ---------------------------------------------------
-- A029
('00000007-0000-4000-8000-000000000029', '00000004-0000-4000-8000-000000000007', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000007', '00000005-0000-4000-8000-000000000017', '00000006-0000-4000-8000-000000000010',
 pg_temp.rc(-1, 4, '11:30'), 'Coffee Shop Cleanup', 2000, 25, 5,
 'COMPLETED', null, null, null, null,
 'Margaret Smith', '+18185552010', 'margaret@twinpeaks.test', null),

-- A030  snapshot price 2600; the live service is now 2800
('00000007-0000-4000-8000-000000000030', '00000004-0000-4000-8000-000000000007', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000007', '00000005-0000-4000-8000-000000000016', '00000006-0000-4000-8000-000000000013',
 pg_temp.rc(-2, 6, '17:00'), 'Blue Jay Fade', 2600, 40, 10,
 'COMPLETED', null, null, null, null,
 'CJ', '+18185552013', 'cj@twinpeaks.test', null),

-- A031
('00000007-0000-4000-8000-000000000031', '00000004-0000-4000-8000-000000000007', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000007', '00000005-0000-4000-8000-000000000016', '00000006-0000-4000-8000-000000000011',
 pg_temp.rc(1, 5, '12:00'), 'Blue Jay Fade', 2800, 40, 10,
 'ACCEPTED', null, null, null, null,
 'Eileen Roberts', '+18185552011', 'eileen@twinpeaks.test', null),

-- A032
('00000007-0000-4000-8000-000000000032', '00000004-0000-4000-8000-000000000007', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000007', '00000005-0000-4000-8000-000000000017', '00000006-0000-4000-8000-000000000008',
 pg_temp.rc(2, 2, '18:30'), 'Coffee Shop Cleanup', 2000, 25, 5,
 'ACCEPTED', null, null, null, null,
 'Muscle Man', '+18185552008', 'muscleman@twinpeaks.test', null),

-- ---- Rigby (chair 08) ------------------------------------------------------
-- A033
('00000007-0000-4000-8000-000000000033', '00000004-0000-4000-8000-000000000008', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000008', '00000005-0000-4000-8000-000000000019', '00000006-0000-4000-8000-000000000008',
 pg_temp.rc(-1, 6, '13:00'), 'Death Punch Lineup', 1000, 15, 10,
 'NO_SHOW', null, null, null, null,
 'Muscle Man', '+18185552008', 'muscleman@twinpeaks.test', null),

-- A034
('00000007-0000-4000-8000-000000000034', '00000004-0000-4000-8000-000000000008', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000008', '00000005-0000-4000-8000-000000000018', '00000006-0000-4000-8000-000000000009',
 pg_temp.rc(-2, 5, '14:00'), 'Trash Panda Trim', 1500, 30, 25,
 'COMPLETED', null, null, null, null,
 'Hi-Five Ghost', '+18185552009', null, null),

-- A035
('00000007-0000-4000-8000-000000000035', '00000004-0000-4000-8000-000000000008', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000008', '00000005-0000-4000-8000-000000000018', '00000006-0000-4000-8000-000000000012',
 pg_temp.rc(1, 4, '12:30'), 'Trash Panda Trim', 1500, 30, 25,
 'ACCEPTED', null, null, null, null,
 'Thomas', '+18185552012', null, null),

-- ---- Skips at REGULAR CUTZ (chair 09) --------------------------------------
-- A036
('00000007-0000-4000-8000-000000000036', '00000004-0000-4000-8000-000000000009', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000009', '00000005-0000-4000-8000-000000000020', '00000006-0000-4000-8000-000000000011',
 pg_temp.rc(-1, 5, '08:00'), 'The Immortal Buzz', 3500, 30, 0,
 'COMPLETED', null, null, null, null,
 'Eileen Roberts', '+18185552011', 'eileen@twinpeaks.test', null),

-- A037  same week as A024, other shop, other timezone, same worker
('00000007-0000-4000-8000-000000000037', '00000004-0000-4000-8000-000000000009', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000009', '00000005-0000-4000-8000-000000000021', '00000006-0000-4000-8000-000000000013',
 pg_temp.rc(1, 4, '09:00'), 'Fixes-Everything Fade', 4000, 35, 5,
 'ACCEPTED', null, null, null, null,
 'CJ', '+18185552013', 'cj@twinpeaks.test', null),

-- ---- Pops (chair 10) -------------------------------------------------------
-- A038  GUEST booking
('00000007-0000-4000-8000-000000000038', '00000004-0000-4000-8000-000000000010', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000010', '00000005-0000-4000-8000-000000000023', null,
 pg_temp.rc(-2, 3, '10:00'), 'Good Show Gentlemans Cut', 4500, 60, 15,
 'COMPLETED', null, null, null, null,
 'Mr. Maellard', '+18185552098', null, null),

-- A039
('00000007-0000-4000-8000-000000000039', '00000004-0000-4000-8000-000000000010', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000010', '00000005-0000-4000-8000-000000000022', '00000006-0000-4000-8000-000000000010',
 pg_temp.rc(-1, 2, '11:00'), 'Lollipop Lineup', 2200, 35, 10,
 'COMPLETED', null, null, null, null,
 'Margaret Smith', '+18185552010', 'margaret@twinpeaks.test', null),

-- A040  GUEST booking, upcoming
('00000007-0000-4000-8000-000000000040', '00000004-0000-4000-8000-000000000010', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000010', '00000005-0000-4000-8000-000000000023', null,
 pg_temp.rc(1, 5, '13:00'), 'Good Show Gentlemans Cut', 4500, 60, 15,
 'ACCEPTED', null, null, null, null,
 'Mr. Maellard', '+18185552098', null, 'The usual, my boy.'),

-- A041
('00000007-0000-4000-8000-000000000041', '00000004-0000-4000-8000-000000000010', '00000002-0000-4000-8000-000000000002', '00000003-0000-4000-8000-000000000010', '00000005-0000-4000-8000-000000000022', '00000006-0000-4000-8000-000000000011',
 pg_temp.rc(2, 3, '10:30'), 'Lollipop Lineup', 2200, 35, 10,
 'ACCEPTED', null, null, null, null,
 'Eileen Roberts', '+18185552011', 'eileen@twinpeaks.test', null);

commit;


-- =============================================================================
-- VERIFICATION -- read-only, safe to re-run
-- =============================================================================

-- Row counts
select 'app_user' as table_name, count(*) from public.app_user
union all select 'establishment',        count(*) from public.establishment
union all select 'establishment_owner',  count(*) from public.establishment_owner
union all select 'worker_profile',       count(*) from public.worker_profile
union all select 'worker_establishment', count(*) from public.worker_establishment
union all select 'worker_schedule_day',  count(*) from public.worker_schedule_day
union all select 'service',              count(*) from public.service
union all select 'worker_time_off',      count(*) from public.worker_time_off
union all select 'client',               count(*) from public.client
union all select 'client_note',          count(*) from public.client_note
union all select 'appointment',          count(*) from public.appointment
order by 1;

-- Roster: who works where, with their derived roles
select e.name                                  as shop,
       w.first_name || ' ' || w.last_name      as worker,
       w.slug,
       case when eo.id is not null then 'owner + worker' else 'worker' end as role,
       (select count(*) from public.service s
         where s.worker_id = w.id and s.is_active)                         as active_services,
       (select count(*) from public.worker_schedule_day d
         where d.worker_establishment_id = we.id)                          as days_worked,
       w.auto_accept
  from public.worker_establishment we
  join public.establishment  e on e.id = we.establishment_id
  join public.worker_profile w on w.id = we.worker_id
  left join public.establishment_owner eo
         on eo.establishment_id = e.id and eo.user_id = w.user_id
 where we.is_active
 order by e.name, w.last_name;

-- Upcoming bookings, rendered in each shop's OWN local time
select e.name                                              as shop,
       w.first_name                                        as worker,
       to_char(a.starts_at at time zone e.timezone,
               'Dy DD Mon HH24:MI')                        as starts_local,
       to_char(a.ends_at   at time zone e.timezone, 'HH24:MI') as ends_local,
       to_char(a.block_ends_at at time zone e.timezone, 'HH24:MI') as chair_free_local,
       a.service_title,
       (a.price_cents / 100.0)::numeric(10,2)              as price,
       a.status,
       a.client_name,
       -- how the client resolves: guests have no client row at all and are
       -- reachable only through the denormalized phone
       case when a.client_id is null  then 'guest (phone only)'
            when c.user_id  is null   then 'client record'
            else                           'signed-up account'
       end                                                 as client_kind
  from public.appointment a
  join public.establishment  e on e.id = a.establishment_id
  join public.worker_profile w on w.id = a.worker_id
  left join public.client    c on c.id = a.client_id
 where a.starts_at >= now()
 order by a.starts_at;

-- Snapshot drift: past bookings whose price no longer matches the live service.
-- These SHOULD appear -- it proves the snapshot is authoritative.
select a.client_name,
       a.service_title,
       (a.price_cents / 100.0)::numeric(10,2) as charged,
       (s.price_cents / 100.0)::numeric(10,2) as current_menu_price,
       s.is_active                            as service_still_offered
  from public.appointment a
  join public.service s on s.id = a.service_id
 where a.price_cents <> s.price_cents
    or not s.is_active
 order by a.starts_at;
