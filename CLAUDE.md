# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

book-me-up is an appointment-booking platform for barbers and similar chair-based
service workers.

| | |
| --- | --- |
| `client/` | React Router v8 (framework mode, SSR on) · React 19 · Tailwind CSS v4 · TypeScript · Vite |
| `server/` | FastAPI · Pydantic v2 · supabase-py · uv · Python 3.12.12 |
| Database | Supabase Postgres, reached over PostgREST — **not** through an ORM |

There is no SQLAlchemy layer and no direct Postgres driver: every query goes through
supabase-py. `SUPABASE_DB_URL` is declared in config but nothing opens a connection with
it. Don't add an ORM or driver dependency without a reason to bypass PostgREST.

`server/sql/` holds `create_tables.sql` (the executable form of the model — tables, the
double-booking exclusion constraint, RLS policies, the busy views, the hold sweeper) and
`mock_data.sql`. `client-old/` is a superseded copy of the frontend that nothing builds or
serves — don't edit it or read it for current behavior. (Repo-wide CI jobs like semgrep
still scan it, so it can surface in a security run.)

## Commands

```bash
# client/
npm run dev          # dev server + HMR at http://localhost:5173
npm run build        # production build to client/build/
npm run start        # serve the built output
npm run typecheck    # react-router typegen && tsc
npm test             # vitest run over client/tests/
npm run test:watch   # re-runs on save
npx vitest run tests/waitlist.test.tsx   # single file

# server/
uv run uvicorn server.main:app --reload    # API; /docs is served unless APP_ENV=production
uv run python scripts/gen_models.py        # regenerate models from the live DB

uv run pytest                              # default addopts already exclude `live`
uv run pytest tests/test_cols.py::test_cols_lists_model_fields   # single test
uv run pytest -m live                      # hits the REAL Supabase project — opt in only
uv run ruff check . --fix
uv run ruff format .
```

There is **no JS linter** — don't invent `npm run lint`. On the server, pytest and ruff
are configured in `pyproject.toml`; client tests run on Vitest, configured in
`client/vitest.config.ts`. All three are enforced by CI.

`.github/workflows/ci.yml` runs `ruff check`, `ruff format --check`, and `pytest -m "not
live"` for the server, and `npm run typecheck`, `npm test`, and `npm run build` for the
client. A second workflow (`security.yml`) runs gitleaks, semgrep, `pip-audit`,
`npm audit`, and zizmor, so a new dependency or a workflow edit can fail CI on its own.

Tests never touch the network: `tests/conftest.py` stuffs fake Supabase settings into
`os.environ` **before** importing `server.main`, because `core/config.py` crashes at import
time on a missing variable. Anything that reaches the database gets `@pytest.mark.live`.

Client tests sit flat in `client/tests/` on jsdom. `tests/setup.ts` adds the jest-dom
matchers and cleanup, and stubs `window.matchMedia`, which jsdom lacks and `Reveal` reads.
Route modules render through `createRoutesStub`, so actions and `useNavigation` behave as
in the app; tests of a real action stub `fetch` and `API_URL`, so nothing reaches the API.
`ssr.test.tsx` renders pages with `renderToString` in the node environment, which is what
catches `window`/`document` reads during render — `npm run build` does not.
`NOTE: change when removing waitlist` marks every expectation that assumes the sign-up
CTAs lead to `/waitlist`.

## Server architecture

Two router pairs, same shape. Each route module owns only HTTP concerns; every query and
every rule lives in the matching `supabase/` module.

| Feature | Route | Query layer | Models |
| --- | --- | --- | --- |
| Landing pages | `routes/apis.py` | `supabase/sb_function.py` | `models/public_models.py` |
| Booking flow | `routes/booking.py` (`/booking` prefix) | `supabase/booking.py` | `models/booking.py` |

Request path: route → query module → Supabase → `to_public()` / `model_validate()` →
Pydantic response model.

### Supabase clients with different privileges

`sb_function.py` builds the first two at import time:

- **`public_db`** — publishable key, **RLS enforced**. Everything a public endpoint touches.
- **`admin_db`** — secret key, **RLS bypassing**. Privileged server-side work only.
- **`user_db(access_token)`** — a context manager that builds a client per request carrying
  the signed-in user's token, so RLS sees `auth.uid()`. Never shared or cached, and only
  used after the `current_user` dependency in `routes/auth.py` has verified the token.
  Run its queries through `_run_as_user`, which turns a rejected token into `NotSignedIn`.

Reaching for `admin_db` in a public read silently disables row-level security. The choice
of client *is* the authorization boundary.

Today there are exactly **two** `admin_db` calls: the appointment insert at the end of
`make_appointment()`, and the waitlist insert in `join_waitlist()`. Both are privileged
because an anonymous client legitimately needs to write a row it may not read back. Every
read in the booking flow goes through `public_db`. Adding another `admin_db` site is a
decision to justify, not a convenience.

### Public models drive the SQL, not just the response

This is the most surprising thing in the codebase and it spans two files. `_cols()` in
`sb_function.py` builds the PostgREST `select` list **from the field names of the Pydantic
public model**:

```python
_WORKER_CARD_COLS = _cols(EstablishmentLandingPage.Workers)
```

Consequences worth internalizing:

- Adding a field to a public model **changes the database query**. The model is the
  response filter and the column list at once.
- A field backed by another table is not a column. It must be passed to `_cols()` as an
  embed expression (`workers=f"workers:worker_establishment(...)"`) or the query 400s on
  the first request.
- Filters on an embedded table (`.eq("worker_establishment.is_active", True)`) filter the
  *embed*, not the outer row.

`models/public_models.py` is the enforcement point for what leaves the server — FastAPI
filters every response through the declared `response_model`. **Returning a bare dict from
a route bypasses that**, so don't.

`supabase/booking.py` imports `_cols` and uses the same trick on module-private models
(`_ChairContext`, `_ServiceTiming`, `_BusyAppointment`) that are read shapes only and never
serialized. So a `_`-prefixed model in that file is still a column list — renaming one of
its fields changes a query.

### Generated vs. hand-written models

- `models/supabase_models.py` is **generated** — `scripts/gen_models.py` reads the live
  PostgREST schema and runs datamodel-codegen. Hand edits get overwritten. Regenerate
  after a migration.
- `models/public_models.py` is **hand-written** and is where the privacy boundary lives.

### Errors

The query layer distinguishes these failure modes and routes must preserve the
distinction. Query functions raise or return; **routes are the only place `HTTPException`
is constructed**:

- `DatabaseUnavailable` → **503**, message deliberately vague. Detail goes to logs only.
- `NotSignedIn` → **401**. A missing, invalid, or expired access token, caught by
  `verify_token` or by PostgREST through `_run_as_user`.
- `None` (no such row) → **404**.
- `SlotTaken` → **409**. Booking flow only.
- `BlankFirstName` → **422**. Booking flow only; checked before any query runs.
- `InvalidSignup` → **422**. Waitlist only; a blank name or unusable email, checked before
  any query runs.

`_run(query, what)` in `sb_function.py` is the house idiom for reads: it catches `APIError`
and `httpx.HTTPError`, logs, and re-raises as `DatabaseUnavailable`. `_run_write()` in
`supabase/booking.py` is the same idiom for the insert with one case pulled back out —
SQLSTATE `23P01` (exclusion violation) becomes `SlotTaken`, so a lost race reads as 409 and
not as a 503 outage. Never collapse those two.

`SlotTaken` covers "you can't have this slot" generally, not just a lost race:
`make_appointment()` also raises it when the posted `starts_at` falls outside the policy
window, lands on a non-working weekday, or simply isn't one of the slots step 2 would have
offered.

A row that fails `model_validate` is also `DatabaseUnavailable("schema mismatch")` — schema
drift is an outage, not a 404.

### The booking flow

Three steps, one shared invariant. `routes/booking.py`, `supabase/booking.py`, and
`models/booking.py` each carry the same three-step docstring; keep them in sync.

1. `GET …/dates` → `get_dates()` → `DatesAvailable` — which local dates hold at least one
   slot.
2. `GET …/times?day=` → `get_times()` → `TimesAvailable` — the slots on one chosen date.
3. `POST /booking/appointments` → `make_appointment()` → `AppointmentBooked`.

**`_iter_day_slots()` is the single definition of "bookable"**, and all three steps go
through it: step 1 short-circuits on the first yield, step 2 lists it, step 3 rebuilds the
set and checks the posted `starts_at` is in it. Adding a rule anywhere else lets the
calendar advertise a day the slot list can't fill. `_load_context()` does the two shared
reads (chair + service) and returns `None` for the 404 cases.

Step 1 and 2 are **UI, not enforcement**. Step 3 re-derives everything from the database:
the policy window, the weekday schedule, the busy set, and `service_title` / `price_cents`
/ `duration_min` / `buffer_after_min`. Nothing about the appointment except the client's
own details comes from the request body.

Availability reads go through two SQL views rather than the base tables —
`appointment_busy` (filtered to `PENDING`/`ACCEPTED`, exposing `block_ends_at`, never
`ends_at`) and `worker_time_off_busy` (drops `reason`). Both are `security_invoker = false`
with `select` granted to `anon`, so they run as their owner and **deliberately bypass the
base tables' RLS** — that is what lets an unauthenticated visitor compute availability
without opening `appointment` (client names, phones) or `worker_time_off` (why someone took
a week off). Their SELECT lists are therefore a privacy boundary of the same kind as
`public_models.py`: adding a column there publishes it. Query the views, not the tables.

Slots are laid on a **15-minute grid** (`_GRID_MIN`) and occupy `duration_min +
buffer_after_min`, while the client-facing `end_time` is `start + duration_min` only.

### Free text is tidied, not sanitized

Names, email, and notes are stored as typed. **SQL injection is handled by
parameterization**: every query goes through the PostgREST builder, and the insert body
travels as JSON that PostgREST binds as one parameter, so `'); DROP TABLE` is just a
string. **XSS is handled at render time**: React escapes text children, so render these
fields as `{appt.client_notes}`. Never pass them through `dangerouslySetInnerHTML`
(semgrep's `p/react` flags it in CI) or into an `href`/`src`, and don't auto-linkify notes
without an `https:` allow-list. An HTML email template needs autoescape on, and a CSV
export must neutralize cells that start with `=`, `+`, `-`, or `@`.

Don't reintroduce a keyword or punctuation filter. The one this replaced stored O'Brien as
`O Brien` and rejected real notes like `my sons' and my cuts` and `"skin fade" or "low
taper"`, failing the booking.

`_clean()` in `supabase/booking.py` is the single pass, and it is storage hygiene:

- NFC, not NFKC, so `½` and full-width text are kept as typed.
- `_INVISIBLE` characters become spaces: control codes (Postgres rejects NUL in text),
  lone surrogates (httpx can't encode them, so the insert would raise), and the bidi
  override/isolate controls (they can make a name display reversed). ZWJ and ZWNJ are
  deliberately not in it — emoji sequences and Persian, Hindi, and Sinhala spelling need
  them.
- Whitespace collapses to single spaces and the ends are trimmed, so every note is one
  line.
- A string with nothing visible left becomes `""`. That is how a blank first name is
  caught (`BlankFirstName`, 422).
- Hard caps: names 100, email 254, notes 1000 (the textarea's `maxLength`).

`_clean_email()` adds NFKC (an address is an identifier) and a lowercase shape check; a
junk address is dropped rather than failing the booking. The phone isn't cleaned at all:
`BookAppointment.Client.phone`'s pattern 422s anything but E.164, and
`appointment_phone_e164_ck` backs it up.

User input reaches PostgREST only as a filter value (`.eq(col, value)`), never formatted
into the strings passed to `.or_()`, `.filter()`, or `.select()`. That would be filter
injection, which parameterization does not cover.

### Config

`core/config.py` loads `server/.env` into a typed settings object. A missing variable is a
**startup crash by design** — never add a default for a secret. New env vars must be
declared there or they are invisible. OpenAPI docs are disabled when `APP_ENV=production`.

`CORS_ORIGINS` accepts a comma-separated string and defaults to the two localhost dev
ports. Production must set it explicitly — the middleware sends `allow_credentials=True`,
and browsers reject that paired with `*`.

## Naming across the three layers

The same concept is spelled three ways, and conversion happens at the model boundary:

| Layer | Spelling |
| --- | --- |
| `docs/schema.md` (DBML) | `WorkerProfile`, `workerEstablishmentId` |
| Postgres / PostgREST | `worker_profile`, `worker_establishment_id` |
| Generated + public models | `WorkerProfile` class, `worker_establishment_id` fields |
| Client TS models | same snake_case as the JSON — `worker_establishment_id` |

The domain rules below use schema.md spelling; the code uses snake_case. One name does not
follow the pattern: schema.md's `User` is **`public.app_user`** in Postgres (`user` is
reserved), so the generated class is `AppUser`.

## Frontend

Framework mode, so routes are configured in `app/routes.ts` (not file-system based) and
route modules under `app/routes/` export `loader` / `action` / `meta` / `links` with types
from `./+types/*`. `app/root.tsx` holds the document shell, font loading, and the
`ErrorBoundary`. `client/README.md` is the unmodified template readme — it does not
describe this project.

### Four directories, one direction of dependency

| | |
| --- | --- |
| `app/routes/` | URL + data. `loader` / `action` / `meta`, `fetch` to the API, error mapping. Renders a page and nothing else. |
| `app/pages/` | One presentational component per route. Takes plain props, does no fetching. |
| `app/widgets/` | Shared pieces. `kit.tsx` is the primitives (container, buttons, reveal); subfolders are page-scoped. |
| `app/models/` | Hand-written TypeScript mirrors of the server's Pydantic response models. |

`app/models/*.ts` are **transcribed by hand from `server/src/server/models/`** — there is no
codegen and nothing validates the JSON at runtime. Changing a server public model means
editing the matching `.ts` in the same commit or the client silently reads `undefined`.
`bookingFlow.ts` mirrors `models/booking.py`; `workerPage.ts` and `establishmentPage.ts`
mirror `public_models.py`.

`app/widgets/21dev/` is dropped-in third-party markup, not written to the design system.
Only `header.tsx` is wired up (imported as `Velaris` by `pages/WorkerPage.tsx`); the
`temp_*` and `pricing_section` files are unused staging. Restyle before adopting one —
they carry arbitrary values the rest of the app forbids.

Loaders call the API through **`process.env.API_URL`**, which comes from `client/.env` and
is read server-side during SSR — it is not a `VITE_`-prefixed variable and is not available
in the browser. Keep fetching in loaders and actions.

The booking route (`book-with/:establishmentId/:workerId/:serviceId`) drives its three
steps through **URL search params** (`?day=`, `?slot=`) rather than component state, so its
loader can re-fetch step 2 on navigation and the whole flow stays shareable and
back-button-safe. `action` maps a 409 from the API to a "pick another time" message, which
is why the server's `SlotTaken` must not arrive as a 503.

**All styling goes through the `design-system` skill.** Tokens live in the `@theme` and
`:root` / `.dark` blocks of `app/app.css`. Never write a raw hex or an arbitrary Tailwind
value; if a token seems missing it belongs in `app.css` first. Two traps documented there:
the radius scale overrides Tailwind's defaults (`rounded-lg` is 12px, not 8px), and
semantic colors must stay in `@theme inline` or dark mode silently breaks for that token.

## Domain model

Full schema in [docs/schema.md](docs/schema.md) — update it in the same change as any
migration that alters the model. The rules below are the ones that are easy to violate and
expensive to unwind.

### Private identity vs. public presence

`User` is private PII and **must never be serialized to a public endpoint**. Every publicly
rendered barber field lives on `WorkerProfile`
(`firstName`/`lastName`/`bio`/`image`/`publicEmail`/`publicPhone`). The two tables
intentionally duplicate names and contact info — that duplication is the privacy boundary,
not an accident to normalize away. `User` ↔ `WorkerProfile` is 1:1; a `User` without a
`WorkerProfile` is an owner or a client-account holder.

`app_user` is not the identity source — **`auth.users` is**, and `app_user` is a read-mirror
kept in sync by the `on_auth_user_created` / `on_auth_user_updated` triggers, because
PostgREST cannot join against the `auth` schema. Create users through Supabase Auth
(`signUp`, passing `first_name` / `last_name` in `options.data`), never by inserting into
`app_user`.

### Roles are derived, not stored

`User.isPlatformAdmin` is the only persisted role. Everything else is computed from row
existence:

- owner of a shop → an `EstablishmentOwner` row for (user, establishment)
- worker at a shop → a `WorkerProfile` plus an active `WorkerEstablishment` row

Authorization checks should query those rows rather than caching a role string.

### The "chair" is the unit of work

`WorkerEstablishment` models one barber's chair at one shop, and is what most scheduling
hangs off. Note the deliberate asymmetry in what is scoped to the chair vs. the person:

| Scoped to the chair (`workerEstablishmentId`) | Scoped to the person (`workerId`) |
| --- | --- |
| `WorkerScheduleDay` — hours differ per shop | `WorkerTimeOff` — blocks *every* shop |
| `Appointment` | `Service` — the menu travels with the barber |
| | booking policy fields on `WorkerProfile` |

So: a barber sets different Tuesday hours at each shop, but taking Tuesday off removes them
from both, and their service list and booking policy are identical everywhere they work.

### Availability is computed, never stored

There is no slots table. Bookable time for a chair on a date is derived from:

1. the `WorkerScheduleDay` row for that `dayOfWeek`, minus the optional
   `breakStartMinute`/`breakEndMinute` window;
2. minus any `WorkerTimeOff` overlapping the day for that `workerId`;
3. minus existing appointments — collide against **`blockEndsAt`**, not `endsAt`, or
   bookings will overlap the buffer;
4. clamped by the `WorkerProfile` policy: `minLeadTimeMin` (earliest bookable offset from
   now) and `maxAdvanceDays` (furthest bookable date).

`WorkerScheduleDay` minutes are 0–1440 **local to `Establishment.timezone`**, while every
`DateTime` column is an absolute instant. Convert at that boundary and nowhere else —
`_minute_to_instant()` is that boundary, and all slot arithmetic downstream of it is done
in UTC. Timezone lives on the establishment, so a barber working two shops in different
zones is a case the conversion must handle.

Two `dayOfWeek` conventions collide here: the database uses Sunday = 0, Python's
`date.weekday()` uses Monday = 0. The code bridges with `(day.weekday() + 1) % 7`.

### Appointments snapshot their service

`serviceTitle`, `priceCents`, `durationMin`, and `bufferAfterMin` are copied onto the
`Appointment` at booking time. **Never join `Service` to display an appointment** —
`serviceId` is retained for analytics only. Editing or deactivating a service must not
retroactively change what a past client was quoted.

Three timestamps, two audiences: `startsAt`→`endsAt` is what the client sees;
`startsAt`→`blockEndsAt` (which includes `bufferAfterMin`) is what the barber sees and what
calendar conflict checks use.

**`endsAt` and `blockEndsAt` are computed by the database, not the app.** The
`appointment_set_times_trg` trigger derives both from `startsAt` + `durationMin` +
`bufferAfterMin` on every insert and on any update to those columns — Postgres cannot
express them as generated columns because `timestamptz + interval` is STABLE, not
IMMUTABLE. Never write them from Python; insert the snapshot fields and read the times
back.

### Booking lifecycle

`PENDING | ACCEPTED | REJECTED | CANCELLED | COMPLETED | NO_SHOW`, with `cancelledBy` one of
`CLIENT | WORKER | SYSTEM`. Two enums spell this in Python and the narrower one is not a
mistake: `public_models.Status` is the full lifecycle, while `booking.BookingStatus` is
`PENDING | ACCEPTED` only — the two states a *brand new* booking can be in. Don't widen it
to "fix" the duplication.

- If `WorkerProfile.autoAccept`, a new booking goes straight to `ACCEPTED`. Otherwise it is
  `PENDING` with `holdExpiresAt = now + holdExpiryHours` (default 24).
- Expired holds are swept to `CANCELLED` with `cancelledBy = SYSTEM` by
  `public.expire_pending_appointments()` (Section 8 of `create_tables.sql`), scheduled
  through pg_cron every 5 minutes. The extension has to be enabled in the Supabase
  dashboard and the `cron.schedule` call run by hand — the SQL file only defines the
  function. `holdExpiresAt` is only meaningful while `PENDING` and is cleared on any other
  transition.
- `PENDING` holds still occupy the slot for conflict purposes.
- Client-initiated cancellation is refused inside `WorkerProfile.cancellationCutoffMin` of
  `startsAt`.

The real double-booking guard is the database, not the slot math: the
`appointment_no_double_booking` GiST exclusion constraint on
`(worker_id, tstzrange(starts_at, block_ends_at))` `where status in ('PENDING',
'ACCEPTED')`. It is keyed on **`workerId`, not the chair** — a barber cannot be in two
chairs at once — and its status predicate matches `appointment_busy`, so the calendar and
the constraint agree on what "taken" means, and rejecting or cancelling frees the slot with
no extra write. Availability reads can always lose the race; the constraint is what
actually settles it.

### Client identity is soft

`Client.phone` is E.164 and is the dedupe key, but it is **deliberately not unique** — one
phone can legitimately back several clients (a parent booking for their kids). Guests book
without ever creating a `Client` row.

`Appointment` and `ClientNote` therefore both carry a nullable `clientId` alongside a
required denormalized `clientPhone`. Resolution order is always: prefer `clientId` when
non-null, otherwise match on phone (then email). Treat these as soft links — the phone
columns must stay populated and correct even when `clientId` is set, since they are the
fallback.

`ClientNote` is barber-authored and private to that `workerId`; it must never be exposed to
the client. `Appointment.clientNotes` is the opposite — client authored, scoped to that
single booking.
