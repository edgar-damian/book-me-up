# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

book-me-up is an appointment-booking platform for barbers and similar
chair-based service workers. The repo is **pre-scaffold**: `client/` and
`server/` exist but are empty, and there is no `package.json`, build, lint, or
test setup yet. The only committed files are `.gitignore` and this document set.

Because there is no code to read, [docs/schema.md](docs/schema.md) is the
authoritative description of the system. Read it before doing domain work, and
update it in the same change as any migration that alters the model.

### What is already decided

- Split `client/` (frontend) and `server/` (backend) at the repo root.
- Postgres via Supabase — `.env` holds `SB_DB_PASSWORD_ON_SETUP`. Supabase Auth
  is the intended identity provider (`User.hashedPassword` is nullable
  specifically so OAuth/Supabase-managed users are representable).

### What is not decided yet

Framework choices for both tiers, the ORM/migration tool, and the test runner.
Do not assume one — ask, or propose and confirm before scaffolding. Once the
stack lands, replace this section with real build/lint/test/single-test
commands.

## Domain model

Full schema in [docs/schema.md](docs/schema.md). The rules below are the ones
that are easy to violate and expensive to unwind.

### Private identity vs. public presence

`User` is private PII and **must never be serialized to a public endpoint**.
Every publicly rendered barber field lives on `WorkerProfile`
(`firstName`/`lastName`/`bio`/`image`/`publicEmail`/`publicPhone`). The two
tables intentionally duplicate names and contact info — that duplication is the
privacy boundary, not an accident to normalize away. `User` ↔ `WorkerProfile` is
1:1; a `User` without a `WorkerProfile` is an owner or a client-account holder.

### Roles are derived, not stored

`User.isPlatformAdmin` is the only persisted role. Everything else is computed
from row existence:

- owner of a shop → an `EstablishmentOwner` row for (user, establishment)
- worker at a shop → a `WorkerProfile` plus an active `WorkerEstablishment` row

Authorization checks should query those rows rather than caching a role string.

### The "chair" is the unit of work

`WorkerEstablishment` models one barber's chair at one shop, and is what most
scheduling hangs off. Note the deliberate asymmetry in what is scoped to the
chair vs. the person:

| Scoped to the chair (`workerEstablishmentId`) | Scoped to the person (`workerId`) |
| --- | --- |
| `WorkerScheduleDay` — hours differ per shop | `WorkerTimeOff` — blocks *every* shop |
| `Appointment` | `Service` — the menu travels with the barber |
| | booking policy fields on `WorkerProfile` |

So: a barber sets different Tuesday hours at each shop, but taking Tuesday off
removes them from both, and their service list and booking policy are identical
everywhere they work.

### Availability is computed, never stored

There is no slots table. Bookable time for a chair on a date is derived from:

1. the `WorkerScheduleDay` row for that `dayOfWeek`, minus the optional
   `breakStartMinute`/`breakEndMinute` window;
2. minus any `WorkerTimeOff` overlapping the day for that `workerId`;
3. minus existing appointments — collide against **`blockEndsAt`**, not
   `endsAt`, or bookings will overlap the buffer;
4. clamped by the `WorkerProfile` policy: `minLeadTimeMin` (earliest bookable
   offset from now) and `maxAdvanceDays` (furthest bookable date).

`WorkerScheduleDay` minutes are 0–1440 **local to `Establishment.timezone`**,
while every `DateTime` column is an absolute instant. Convert at that boundary
and nowhere else. Timezone lives on the establishment, so a barber working two
shops in different zones is a case the conversion must handle.

### Appointments snapshot their service

`serviceTitle`, `priceCents`, `durationMin`, and `bufferAfterMin` are copied
onto the `Appointment` at booking time. **Never join `Service` to display an
appointment** — `serviceId` is retained for analytics only. Editing or
deactivating a service must not retroactively change what a past client was
quoted.

Three timestamps, two audiences: `startsAt`→`endsAt` is what the client sees;
`startsAt`→`blockEndsAt` (which includes `bufferAfterMin`) is what the barber
sees and what calendar conflict checks use.

### Booking lifecycle

`PENDING | ACCEPTED | REJECTED | CANCELLED | COMPLETED | NO_SHOW`, with
`cancelledBy` one of `CLIENT | WORKER | SYSTEM`.

- If `WorkerProfile.autoAccept`, a new booking goes straight to `ACCEPTED`.
  Otherwise it is `PENDING` with `holdExpiresAt = now + holdExpiryHours`
  (default 24).
- Expired holds are swept to `CANCELLED` with `cancelledBy = SYSTEM`. This needs
  a scheduled job; `holdExpiresAt` is only meaningful while `PENDING` and should
  be cleared on any other transition.
- `PENDING` holds still occupy the slot for conflict purposes.
- Client-initiated cancellation is refused inside
  `WorkerProfile.cancellationCutoffMin` of `startsAt`.

### Client identity is soft

`Client.phone` is E.164 and is the dedupe key, but it is **deliberately not
unique** — one phone can legitimately back several clients (a parent booking for
their kids). Guests book without ever creating a `Client` row.

`Appointment` and `ClientNote` therefore both carry a nullable `clientId`
alongside a required denormalized `clientPhone`. Resolution order is always:
prefer `clientId` when non-null, otherwise match on phone (then email). Treat
these as soft links — the phone columns must stay populated and correct even
when `clientId` is set, since they are the fallback.

`ClientNote` is barber-authored and private to that `workerId`; it must never be
exposed to the client. `Appointment.clientNotes` is the opposite — client
authored, scoped to that single booking.
