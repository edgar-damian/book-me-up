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

`sqlalchemy`, `asyncpg`, and `sqlacodegen` appear in `server/pyproject.toml` but are not
imported anywhere in `src/` or `scripts/`. Don't assume a SQLAlchemy layer exists.

## Commands

```bash
# client/
npm run dev          # dev server + HMR at http://localhost:5173
npm run build        # production build to client/build/
npm run start        # serve the built output
npm run typecheck    # react-router typegen && tsc

# server/
uv run uvicorn server.main:app --reload    # API; /docs is served unless APP_ENV=production
uv run python scripts/gen_models.py        # regenerate models from the live DB
```

**There is no test runner, linter, or formatter configured in either tier**, and no test
files exist. Don't invent a `npm test` or `pytest` invocation — if tests are wanted, the
runner is an open decision to raise first.

## Server architecture

Request path: `routes/apis.py` → `supabase/sb_function.py` → Supabase → `to_public()` →
Pydantic response model.

### Two Supabase clients with different privileges

`sb_function.py` builds both at import time:

- **`public_db`** — publishable key, **RLS enforced**. Everything a public endpoint touches.
- **`admin_db`** — secret key, **RLS bypassing**. Privileged server-side work only.

Reaching for `admin_db` in a public read silently disables row-level security. The choice
of client *is* the authorization boundary.

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

### Generated vs. hand-written models

- `models/supabase_models.py` is **generated** — `scripts/gen_models.py` reads the live
  PostgREST schema and runs datamodel-codegen. Hand edits get overwritten. Regenerate
  after a migration.
- `models/public_models.py` is **hand-written** and is where the privacy boundary lives.

### Errors

`sb_function.py` distinguishes two failure modes and routes must preserve the distinction:

- `DatabaseUnavailable` → **503**, message deliberately vague. Detail goes to logs only.
- `None` (no such row) → **404**.

### Config

`core/config.py` loads `server/.env` into a typed settings object. A missing variable is a
**startup crash by design** — never add a default for a secret. New env vars must be
declared there or they are invisible. OpenAPI docs are disabled when `APP_ENV=production`.

## Naming across the three layers

The same concept is spelled three ways, and conversion happens at the model boundary:

| Layer | Spelling |
| --- | --- |
| `docs/schema.md` (DBML) | `WorkerProfile`, `workerEstablishmentId` |
| Postgres / PostgREST | `worker_profile`, `worker_establishment_id` |
| Generated + public models | `WorkerProfile` class, `worker_establishment_id` fields |

The domain rules below use schema.md spelling; the code uses snake_case.

## Frontend

Framework mode, so routes are configured in `app/routes.ts` (not file-system based) and
route modules under `app/routes/` export `loader` / `action` / `meta` / `links` with types
from `./+types/*`. `app/root.tsx` holds the document shell, font loading, and the
`ErrorBoundary`.

`app/welcome/` is leftover React Router starter template and is not part of the product.
`client/README.md` is the unmodified template readme — it does not describe this project.

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
`DateTime` column is an absolute instant. Convert at that boundary and nowhere else.
Timezone lives on the establishment, so a barber working two shops in different zones is a
case the conversion must handle.

### Appointments snapshot their service

`serviceTitle`, `priceCents`, `durationMin`, and `bufferAfterMin` are copied onto the
`Appointment` at booking time. **Never join `Service` to display an appointment** —
`serviceId` is retained for analytics only. Editing or deactivating a service must not
retroactively change what a past client was quoted.

Three timestamps, two audiences: `startsAt`→`endsAt` is what the client sees;
`startsAt`→`blockEndsAt` (which includes `bufferAfterMin`) is what the barber sees and what
calendar conflict checks use.

### Booking lifecycle

`PENDING | ACCEPTED | REJECTED | CANCELLED | COMPLETED | NO_SHOW`, with `cancelledBy` one of
`CLIENT | WORKER | SYSTEM`.

- If `WorkerProfile.autoAccept`, a new booking goes straight to `ACCEPTED`. Otherwise it is
  `PENDING` with `holdExpiresAt = now + holdExpiryHours` (default 24).
- Expired holds are swept to `CANCELLED` with `cancelledBy = SYSTEM`. This needs a scheduled
  job; `holdExpiresAt` is only meaningful while `PENDING` and should be cleared on any other
  transition.
- `PENDING` holds still occupy the slot for conflict purposes.
- Client-initiated cancellation is refused inside `WorkerProfile.cancellationCutoffMin` of
  `startsAt`.

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
