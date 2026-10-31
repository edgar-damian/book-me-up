"""
Queries behind the worker dashboard. Each one runs through user_db as the
caller, so RLS decides what it can read and write. Nothing here uses admin_db.
"""

import logging
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from postgrest import APIError, ReturnMethod
from pydantic import AwareDatetime, BaseModel, ValidationError

from server.models.dashboard import (
    Answer,
    MyAppointment,
    MyChair,
    MyDay,
    MyService,
    MyStretch,
    MyTimeOff,
    MyWeek,
    MyWorkerProfile,
    SaveService,
    SaveStretch,
    SaveWorkerProfile,
    ScheduleDay,
    TimeOffConflict,
)
from server.models.public_models import CancelledBy, Status
from server.supabase.auth import Caller
from server.supabase.booking import (
    _NAME_CAP,
    _clean,
    _clean_email,
    _minute_to_instant,
    _open_intervals,
)
from server.supabase.sb_function import (
    _TOKEN_REJECTED,
    DatabaseUnavailable,
    NotSignedIn,
    _cols,
    _run_as_user,
    user_db,
)

logger = logging.getLogger(__name__)

_UNIQUE_VIOLATION = "23505"
_SLUG_KEY = "worker_profile_slug_key"

# The bio and description caps match the maxLength on those form boxes.
_BIO_CAP = 1000
_SERVICE_TEXT_CAP = 1000
_SERVICE_TITLE_CAP = 100

_PROFILE_COLS = _cols(MyWorkerProfile)


class InvalidProfile(ValueError):
    """A blank name or an unusable email. Route turns this into a 422."""


class SlugTaken(ValueError):
    """Another worker's page already uses this slug. Route turns this into a 409."""


class ProfileMissing(RuntimeError):
    """The caller has no worker profile to join a shop with. Route turns this into a 409."""


class InvalidService(ValueError):
    """A service whose name is blank once tidied. Route turns this into a 422."""


class RequestClosed(RuntimeError):
    """The booking isn't waiting on an answer anymore. Route turns this into a 409."""


class _Shop(BaseModel):
    """One live establishment, found by its slug."""

    id: UUID
    slug: str
    name: str
    timezone: str


class _MyChairs(BaseModel):
    """
    The caller's worker_profile id, with every chair row of theirs embedded. Read
    through worker_profile because worker_establishment_self_read also shows an
    owner every chair at their shop.
    """

    class Chair(BaseModel):
        id: UUID
        is_active: bool
        ended_at: AwareDatetime | None = None
        establishment: _Shop
        worker_schedule_day: list[ScheduleDay]

    id: UUID
    worker_establishment: list[Chair]


class _Inserted(BaseModel):
    """The id of a row this module just inserted."""

    id: UUID


_SHOP_COLS = _cols(_Shop)
_MY_CHAIRS_COLS = _cols(
    _MyChairs,
    worker_establishment=(
        "worker_establishment("
        + _cols(
            _MyChairs.Chair,
            establishment=f"establishment!inner({_SHOP_COLS})",
            worker_schedule_day=f"worker_schedule_day({_cols(ScheduleDay)})",
        )
        + ")"
    ),
)


class _MyServices(BaseModel):
    """
    The caller's worker_profile id, with the services they offer embedded. Read
    through worker_profile because RLS also shows everyone's active services.
    """

    id: UUID
    service: list[MyService]


_MY_SERVICES_COLS = _cols(_MyServices, service=f"service({_cols(MyService)})")

_WEEK_DAYS = 7


class _TimeOff(BaseModel):
    """One stretch of the caller's time off. It blocks every shop they work at."""

    starts: AwareDatetime
    ends: AwareDatetime


class _Stretch(BaseModel):
    """One stretch of the caller's time off, with the id a save changes it by."""

    id: UUID
    starts: AwareDatetime
    ends: AwareDatetime


class _Booked(TimeOffConflict):
    """A booking as the time off check reads it. block_ends_at keeps the buffer in the overlap."""

    block_ends_at: AwareDatetime


_APPOINTMENT_COLS = _cols(MyAppointment)
_TIME_OFF_COLS = _cols(_TimeOff)
_STRETCH_COLS = _cols(_Stretch)
_BOOKED_COLS = _cols(_Booked, shop=f"shop:establishment({_cols(TimeOffConflict.Shop)})")


def _run_profile_write(query, what: str):
    """
    _run_as_user, but tells a taken slug apart from a real failure.

    Args:
        - query: the PostgREST query to execute
        - what (str): label for the log line

    Returns:
        - The PostgREST response

    Raises:
        - SlugTaken: the slug's unique constraint rejected the write
        - NotSignedIn: PostgREST rejected the caller's token
        - DatabaseUnavailable: anything else
    """
    try:
        return query.execute()
    except APIError as exc:
        if exc.code == _UNIQUE_VIOLATION and _SLUG_KEY in str(exc.message):
            logger.info("%s hit a taken slug", what)
            raise SlugTaken(str(exc)) from exc
        if exc.code in _TOKEN_REJECTED:
            logger.info("%s query rejected the jwt: %s", what, exc.code)
            raise NotSignedIn(exc.code) from exc
        logger.exception("%s query failed", what)
        raise DatabaseUnavailable(str(exc)) from exc
    except httpx.HTTPError as exc:
        logger.exception("%s query failed", what)
        raise DatabaseUnavailable(str(exc)) from exc


def get_profile(caller: Caller) -> MyWorkerProfile | None:
    """
    The caller's own worker profile, hidden or live, read as the caller so RLS applies.

    Args:
        - caller (Caller): from verify_token

    Returns:
        - MyWorkerProfile, or None when the caller has no profile yet

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: the query failed, or the row didn't match MyWorkerProfile
    """
    # RLS also lets the caller read every live profile, so the filter is needed.
    with user_db(caller.access_token) as db:
        resp = _run_as_user(
            db.table("worker_profile").select(_PROFILE_COLS).eq("user_id", caller.user_id).limit(1),
            "worker_profile",
        )

    if not resp.data:
        return None
    try:
        return MyWorkerProfile.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("worker_profile row failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc


def save_profile(caller: Caller, profile: SaveWorkerProfile) -> MyWorkerProfile:
    """
    Updates the caller's worker profile, or creates it when they have none. A new
    profile starts hidden: worker_profile_self_insert refuses any other, and the
    column defaults to true, so is_active is always sent on insert.

    Args:
        - caller (Caller): from verify_token
        - profile (SaveWorkerProfile): what the profile form posted

    Returns:
        - MyWorkerProfile: the saved row

    Raises:
        - InvalidProfile: a blank name or an unusable email, checked before any query
        - SlugTaken: another worker's page uses this slug
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a write failed, or the saved row didn't match MyWorkerProfile
    """
    first_name = _clean(profile.first_name, _NAME_CAP)
    last_name = _clean(profile.last_name, _NAME_CAP)
    if not first_name or not last_name:
        raise InvalidProfile("First and last name are required")
    email = None
    if profile.public_email is not None:
        email = _clean_email(profile.public_email)
        if email is None:
            raise InvalidProfile("Enter a valid email address")

    row = {
        "slug": profile.slug,
        "first_name": first_name,
        "last_name": last_name,
        "bio": _clean(profile.bio, _BIO_CAP),
        "public_email": email,
        "public_phone": profile.public_phone,
    }
    with user_db(caller.access_token) as db:
        resp = _run_profile_write(
            db.table("worker_profile").update(row).eq("user_id", caller.user_id),
            "worker_profile update",
        )
        if not resp.data:
            resp = _run_profile_write(
                db.table("worker_profile").insert(
                    row | {"user_id": caller.user_id, "is_active": False}
                ),
                "worker_profile insert",
            )

    if not resp.data:
        raise DatabaseUnavailable("write returned no row")
    try:
        return MyWorkerProfile.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("saved worker_profile failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc


def _load_chairs(db, caller: Caller) -> _MyChairs | None:
    """The caller's profile id and chair rows, or None when they have no profile."""
    resp = _run_as_user(
        db.table("worker_profile").select(_MY_CHAIRS_COLS).eq("user_id", caller.user_id).limit(1),
        "worker chairs",
    )
    if not resp.data:
        return None
    try:
        return _MyChairs.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("worker chairs failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc


def _to_chair(chair: _MyChairs.Chair) -> MyChair:
    shop = chair.establishment
    return MyChair(
        id=chair.id,
        shop=MyChair.Shop(slug=shop.slug, name=shop.name),
        is_active=chair.is_active,
        schedule_days=sorted(chair.worker_schedule_day, key=lambda d: d.day_of_week),
    )


def get_chairs(caller: Caller) -> list[MyChair]:
    """
    The shops the caller works at or has asked to join, read as the caller.

    Args:
        - caller (Caller): from verify_token

    Returns:
        - list[MyChair]: chairs that haven't ended, empty when the caller has no profile

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: the query failed, or the row didn't match _MyChairs
    """
    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)

    if mine is None:
        return []
    return [_to_chair(c) for c in mine.worker_establishment if c.ended_at is None]


def request_chair(caller: Caller, slug: str) -> MyChair | None:
    """
    Asks to join the live shop with this slug. While setting up, a worker waits on
    one shop at a time, so a request still waiting at another shop is withdrawn. A
    chair they already hold or wait on here comes back as it is. Each step is safe
    to repeat, so a retry after a failure ends in the same place.

    Args:
        - caller (Caller): from verify_token
        - slug (str): the shop's slug, already checked by JoinShop

    Returns:
        - MyChair: the request, or the chair the caller already has at this shop
        - None: no live shop has this slug. Route turns this into a 404.

    Raises:
        - ProfileMissing: the caller has no worker profile yet
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, or a row didn't match its model
    """
    with user_db(caller.access_token) as db:
        resp = _run_as_user(
            db.table("establishment")
            .select(_SHOP_COLS)
            .eq("slug", slug)
            .eq("is_active", True)
            .limit(1),
            "establishment by slug",
        )
        if not resp.data:
            logger.info("join request for a slug no live shop has: %s", slug)
            return None
        try:
            shop = _Shop.model_validate(resp.data[0])
        except ValidationError as exc:
            logger.exception("establishment row failed validation")
            raise DatabaseUnavailable("schema mismatch") from exc

        mine = _load_chairs(db, caller)
        if mine is None:
            raise ProfileMissing()

        # The worker_id filter matters: worker_establishment_self_delete also lets
        # an owner delete the chairs at their own shop.
        _run_as_user(
            db.table("worker_establishment")
            .delete(returning=ReturnMethod.minimal)
            .eq("worker_id", str(mine.id))
            .eq("is_active", False)
            .is_("ended_at", None)
            .neq("establishment_id", str(shop.id)),
            "withdraw waiting requests",
        )

        here = next(
            (
                c
                for c in mine.worker_establishment
                if c.ended_at is None and c.establishment.id == shop.id
            ),
            None,
        )
        if here is not None:
            return _to_chair(here)

        # The unique index only covers active chairs, so the check above is what
        # stops a repeat from inserting a second waiting row.
        resp = _run_as_user(
            db.table("worker_establishment").insert(
                {"worker_id": str(mine.id), "establishment_id": str(shop.id), "is_active": False}
            ),
            "join request",
        )

    if not resp.data:
        raise DatabaseUnavailable("insert returned no row")
    try:
        added = _Inserted.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("inserted chair failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc
    return _to_chair(
        _MyChairs.Chair(id=added.id, is_active=False, establishment=shop, worker_schedule_day=[])
    )


def save_schedule(
    caller: Caller, chair_id: UUID, days: list[ScheduleDay]
) -> list[ScheduleDay] | None:
    """
    Sets the caller's week at one of their chairs: the posted days are written and
    every other day is closed. Hours belong to the chair, so a worker can keep
    different hours at each shop. Both writes are safe to repeat.

    Args:
        - caller (Caller): from verify_token
        - chair_id (UUID): a chair the caller holds or is waiting on
        - days (list[ScheduleDay]): the open days, already checked by SaveSchedule

    Returns:
        - list[ScheduleDay]: the open days, Sunday first
        - None: chair_id isn't one of the caller's current chairs. Route turns this
          into a 404.

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, or a row didn't match its model
    """
    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)
        if mine is None or not any(
            c.id == chair_id and c.ended_at is None for c in mine.worker_establishment
        ):
            logger.info("hours for a chair the caller doesn't hold: %s", chair_id)
            return None

        rows = [d.model_dump() | {"worker_establishment_id": str(chair_id)} for d in days]
        _run_as_user(
            db.table("worker_schedule_day").upsert(
                rows,
                on_conflict="worker_establishment_id,day_of_week",
                returning=ReturnMethod.minimal,
            ),
            "schedule upsert",
        )
        closed = sorted(set(range(7)) - {d.day_of_week for d in days})
        if closed:
            _run_as_user(
                db.table("worker_schedule_day")
                .delete(returning=ReturnMethod.minimal)
                .eq("worker_establishment_id", str(chair_id))
                .in_("day_of_week", closed),
                "close days",
            )

    return sorted(days, key=lambda d: d.day_of_week)


def _load_services(db, caller: Caller) -> _MyServices | None:
    """The caller's profile id and offered services, oldest first, or None with no profile."""
    resp = _run_as_user(
        db.table("worker_profile")
        .select(_MY_SERVICES_COLS)
        .eq("user_id", caller.user_id)
        .eq("service.is_active", True)
        .order("created_at", foreign_table="service")
        .limit(1),
        "worker services",
    )
    if not resp.data:
        return None
    try:
        return _MyServices.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("worker services failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc


def get_services(caller: Caller) -> list[MyService]:
    """
    The services the caller offers, oldest first, read as the caller.

    Args:
        - caller (Caller): from verify_token

    Returns:
        - list[MyService]: active services, empty when the caller has no profile

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: the query failed, or the row didn't match _MyServices
    """
    with user_db(caller.access_token) as db:
        mine = _load_services(db, caller)

    return [] if mine is None else mine.service


def save_services(caller: Caller, services: list[SaveService]) -> list[MyService]:
    """
    Makes the posted list the caller's whole menu. A saved service left out is
    turned off, not deleted: an appointment keeps pointing at the service it was
    booked for. A posted id that isn't one of the caller's saved services is
    added as a new service.

    The inserts run last, so a failed save that the worker retries never adds
    the same service twice.

    Args:
        - caller (Caller): from verify_token
        - services (list[SaveService]): the menu, already checked by SaveServices

    Returns:
        - list[MyService]: the menu as saved, oldest first

    Raises:
        - InvalidService: a name with nothing visible left, checked before any query
        - ProfileMissing: the caller has no worker profile yet
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, or a row didn't match its model
    """
    rows: list[tuple[UUID | None, dict]] = []
    for s in services:
        title = _clean(s.title, _SERVICE_TITLE_CAP)
        if not title:
            raise InvalidService("Every service needs a name")
        rows.append(
            (
                s.id,
                {
                    "title": title,
                    "description": _clean(s.description, _SERVICE_TEXT_CAP),
                    "price_cents": s.price_cents,
                    "duration_min": s.duration_min,
                    "buffer_after_min": s.buffer_after_min,
                },
            )
        )

    with user_db(caller.access_token) as db:
        mine = _load_services(db, caller)
        if mine is None:
            raise ProfileMissing()
        me = str(mine.id)
        saved = {svc.id for svc in mine.service}
        kept = [row | {"id": str(sid), "worker_id": me} for sid, row in rows if sid in saved]
        added = [row | {"worker_id": me} for sid, row in rows if sid not in saved]
        dropped = sorted(str(i) for i in saved - {sid for sid, _ in rows})

        if dropped:
            _run_as_user(
                db.table("service")
                .update({"is_active": False}, returning=ReturnMethod.minimal)
                .eq("worker_id", me)
                .in_("id", dropped),
                "turn off services",
            )
        if kept:
            _run_as_user(
                db.table("service").upsert(kept, on_conflict="id", returning=ReturnMethod.minimal),
                "update services",
            )
        if added:
            _run_as_user(
                db.table("service").insert(added, returning=ReturnMethod.minimal),
                "add services",
            )

        mine = _load_services(db, caller)

    return [] if mine is None else mine.service


def _held_chair(mine: _MyChairs | None, chair_id: UUID) -> _MyChairs.Chair | None:
    """The caller's chair with this id, held or waiting, or None when it isn't one of theirs."""
    held = [] if mine is None else mine.worker_establishment
    return next((c for c in held if c.id == chair_id and c.ended_at is None), None)


def _zone_of(shop: _Shop) -> ZoneInfo:
    """The shop's time zone. One that can't be resolved is an outage, not a 404."""
    try:
        return ZoneInfo(shop.timezone)
    except ZoneInfoNotFoundError as exc:
        logger.exception("establishment=%s has unusable timezone %r", shop.id, shop.timezone)
        raise DatabaseUnavailable("bad timezone") from exc


def _day_off(
    day: date, hours: ScheduleDay | None, zone: ZoneInfo, time_off: list[_TimeOff]
) -> bool:
    """
    True when the chair has no hours on this day, or each open stretch of them
    falls inside one stretch of time off. Partial time off leaves a working day.
    """
    if hours is None:
        return True
    return all(
        any(
            off.starts <= _minute_to_instant(day, lo, zone)
            and off.ends >= _minute_to_instant(day, hi, zone)
            for off in time_off
        )
        for lo, hi in _open_intervals(hours)
    )


def get_week(caller: Caller, chair_id: UUID, *, now_utc: datetime | None = None) -> MyWeek | None:
    """
    The caller's next seven days at one of their chairs, today first, read as the
    caller. Days follow the shop's own calendar, so a worker at shops in two time
    zones can have a different today at each. Cancelled bookings are left out.

    Args:
        - caller (Caller): from verify_token
        - chair_id (UUID): a chair the caller holds or is waiting on
        - now_utc (datetime | None): override for the current instant

    Returns:
        - MyWeek: seven days, each with its bookings in start order
        - None: chair_id isn't one of the caller's current chairs. Route turns this
          into a 404.

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, a row didn't match its model, or the
          shop's time zone can't be resolved
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)
        chair = _held_chair(mine, chair_id)
        if mine is None or chair is None:
            logger.info("week for a chair the caller doesn't hold: %s", chair_id)
            return None

        shop = chair.establishment
        zone = _zone_of(shop)
        today = now_utc.astimezone(zone).date()
        lo = _minute_to_instant(today, 0, zone).isoformat()
        hi = _minute_to_instant(today + timedelta(days=_WEEK_DAYS), 0, zone).isoformat()

        # The worker_id filter matters: appointment_read also shows an owner every
        # booking at their shop.
        booked = _run_as_user(
            db.table("appointment")
            .select(_APPOINTMENT_COLS)
            .eq("worker_id", str(mine.id))
            .eq("establishment_id", str(shop.id))
            .gte("starts_at", lo)
            .lt("starts_at", hi)
            .neq("status", Status.CANCELLED)
            .order("starts_at"),
            "upcoming appointments",
        )
        away = _run_as_user(
            db.table("worker_time_off")
            .select(_TIME_OFF_COLS)
            .eq("worker_id", str(mine.id))
            .lt("starts", hi)
            .gt("ends", lo),
            "time off",
        )

    try:
        appointments = [MyAppointment.model_validate(r) for r in booked.data]
        time_off = [_TimeOff.model_validate(r) for r in away.data]
    except ValidationError as exc:
        logger.exception("week rows failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc

    by_day: dict[date, list[MyAppointment]] = defaultdict(list)
    for appt in appointments:
        by_day[appt.starts_at.astimezone(zone).date()].append(appt)
    hours = {d.day_of_week: d for d in chair.worker_schedule_day}

    days = [today + timedelta(days=i) for i in range(_WEEK_DAYS)]
    return MyWeek(
        timezone=shop.timezone,
        days=[
            MyDay(
                day=day,
                day_off=_day_off(day, hours.get((day.weekday() + 1) % 7), zone, time_off),
                appointments=by_day[day],
            )
            for day in days
        ],
    )


def answer_request(
    caller: Caller, appointment_id: UUID, answer: Answer, *, now_utc: datetime | None = None
) -> MyAppointment | None:
    """
    Accepts or rejects one of the caller's booking requests, as the caller. Only a
    PENDING booking changes, so an answer from another tab, or the hold sweeper
    getting there first, is never overwritten. Asking for the status a booking
    already has changes nothing, so a repeat is safe.

    Args:
        - caller (Caller): from verify_token
        - appointment_id (UUID): one of the caller's bookings
        - answer (Answer): ACCEPTED or REJECTED
        - now_utc (datetime | None): override for the current instant

    Returns:
        - MyAppointment: the booking with its answer
        - None: the caller has no booking with this id. Route turns this into a 404.

    Raises:
        - RequestClosed: the booking isn't PENDING, and has another status
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, or the row didn't match MyAppointment
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    # A hold only stands while PENDING (appointment_hold_only_pending_ck), and a
    # rejection says who and when (appointment_cancel_fields_ck).
    changes: dict[str, str | None] = {"status": answer, "hold_expires_at": None}
    if answer is Answer.REJECTED:
        changes |= {"cancelled_by": CancelledBy.WORKER, "cancelled_at": now_utc.isoformat()}

    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)
        if mine is None:
            logger.info("answer from a caller with no profile: %s", appointment_id)
            return None

        # The worker_id filter matters: appointment_worker_write also lets an owner
        # update every booking at their shop.
        resp = _run_as_user(
            db.table("appointment")
            .update(changes)
            .eq("id", str(appointment_id))
            .eq("worker_id", str(mine.id))
            .eq("status", Status.PENDING)
            .select(_APPOINTMENT_COLS),
            "answer request",
        )
        # Nothing matched, so the booking isn't the caller's or isn't PENDING.
        if not resp.data:
            resp = _run_as_user(
                db.table("appointment")
                .select(_APPOINTMENT_COLS)
                .eq("id", str(appointment_id))
                .eq("worker_id", str(mine.id))
                .limit(1),
                "answered request",
            )

    if not resp.data:
        logger.info("answer for a booking the caller doesn't have: %s", appointment_id)
        return None
    try:
        answered = MyAppointment.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("answered booking failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc
    if answered.status != answer:
        logger.info("%s for a booking already %s: %s", answer, answered.status, appointment_id)
        raise RequestClosed(answered.status)
    return answered


def _overlaps(booking: _Booked, stretch: _Stretch) -> bool:
    """The booking, buffer included, runs into the stretch. Same test as _iter_day_slots."""
    return booking.starts_at < stretch.ends and booking.block_ends_at > stretch.starts


def _local_days(stretch: _Stretch, zone: ZoneInfo) -> tuple[date, date]:
    """The first and last day a stretch touches on the shop's calendar. ends is exclusive."""
    last = stretch.ends - timedelta(microseconds=1)
    return stretch.starts.astimezone(zone).date(), last.astimezone(zone).date()


def _instants(stretch: SaveStretch, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """The midnights that open the stretch's first day and close its last."""
    return (
        _minute_to_instant(stretch.first_day, 0, zone),
        _minute_to_instant(stretch.last_day + timedelta(days=1), 0, zone),
    )


def _time_off_row(worker_id: str, span: tuple[datetime, datetime]) -> dict:
    starts, ends = span
    return {"worker_id": worker_id, "starts": starts.isoformat(), "ends": ends.isoformat()}


def _load_stretches(db, worker_id: UUID, now_utc: datetime) -> list[_Stretch]:
    """The caller's time off that hasn't ended, soonest first."""
    resp = _run_as_user(
        db.table("worker_time_off")
        .select(_STRETCH_COLS)
        .eq("worker_id", str(worker_id))
        .gt("ends", now_utc.isoformat())
        .order("starts"),
        "upcoming time off",
    )
    try:
        return [_Stretch.model_validate(r) for r in resp.data]
    except ValidationError as exc:
        logger.exception("time off rows failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc


def _load_bookings(
    db, worker_id: UUID, stretches: list[_Stretch], now_utc: datetime
) -> list[_Booked]:
    """
    The caller's bookings at every shop that fall in these stretches and haven't
    ended, soonest first. Only PENDING and ACCEPTED hold a slot, so these are the
    bookings the booking flow would no longer offer.
    """
    if not stretches:
        return []
    # The worker_id filter matters: appointment_read also shows an owner every
    # booking at their shop.
    resp = _run_as_user(
        db.table("appointment")
        .select(_BOOKED_COLS)
        .eq("worker_id", str(worker_id))
        .in_("status", [Status.PENDING, Status.ACCEPTED])
        .lt("starts_at", max(s.ends for s in stretches).isoformat())
        .gt("block_ends_at", max(min(s.starts for s in stretches), now_utc).isoformat())
        .order("starts_at"),
        "bookings in time off",
    )
    try:
        booked = [_Booked.model_validate(r) for r in resp.data]
    except ValidationError as exc:
        logger.exception("bookings in time off failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc
    # The query also spans the gaps between stretches.
    return [b for b in booked if any(_overlaps(b, s) for s in stretches)]


def _to_time_off(
    shop: _Shop, zone: ZoneInfo, now_utc: datetime, stretches: list[_Stretch], booked: list[_Booked]
) -> MyTimeOff:
    listed = []
    for s in stretches:
        first, last = _local_days(s, zone)
        count = sum(1 for b in booked if _overlaps(b, s))
        listed.append(MyStretch(id=s.id, first_day=first, last_day=last, bookings=count))
    return MyTimeOff(
        timezone=shop.timezone,
        today=now_utc.astimezone(zone).date(),
        stretches=listed,
        conflicts=[
            TimeOffConflict.model_validate(b.model_dump(exclude={"block_ends_at"})) for b in booked
        ],
    )


def get_time_off(
    caller: Caller, chair_id: UUID, *, now_utc: datetime | None = None
) -> MyTimeOff | None:
    """
    The caller's time off still to come, read as the caller, with the days on
    the calendar of one of their chairs' shops. Time off belongs to the person,
    not the chair: it blocks every shop they work at, and it is checked against
    their bookings at all of them.

    Args:
        - caller (Caller): from verify_token
        - chair_id (UUID): a chair the caller holds or is waiting on, whose shop's
          calendar the days are on
        - now_utc (datetime | None): override for the current instant

    Returns:
        - MyTimeOff: stretches that haven't ended, soonest first, and the bookings
          they overlap
        - None: chair_id isn't one of the caller's current chairs. Route turns this
          into a 404.

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, a row didn't match its model, or the
          shop's time zone can't be resolved
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)
        chair = _held_chair(mine, chair_id)
        if mine is None or chair is None:
            logger.info("time off at a chair the caller doesn't hold: %s", chair_id)
            return None
        zone = _zone_of(chair.establishment)
        stretches = _load_stretches(db, mine.id, now_utc)
        booked = _load_bookings(db, mine.id, stretches, now_utc)

    return _to_time_off(chair.establishment, zone, now_utc, stretches, booked)


def save_time_off(
    caller: Caller,
    chair_id: UUID,
    stretches: list[SaveStretch],
    *,
    now_utc: datetime | None = None,
) -> MyTimeOff | None:
    """
    Makes the posted stretches the caller's time off still to come, with the
    days on the calendar of one of their chairs' shops. A stretch that hasn't
    ended and is left out is removed; one that has ended is never touched. A
    stretch whose days didn't change isn't rewritten, so it keeps the instants
    it was saved with, and a new stretch that repeats another is skipped.

    Time off is saved whatever it overlaps. The bookings that fall in it come
    back with it, for the worker to sort out with their clients.

    The inserts run last, so a failed save that the worker retries never adds
    the same stretch twice.

    Args:
        - caller (Caller): from verify_token
        - chair_id (UUID): a chair the caller holds or is waiting on, whose shop's
          calendar the days are on
        - stretches (list[SaveStretch]): the time off, already checked by SaveTimeOff
        - now_utc (datetime | None): override for the current instant

    Returns:
        - MyTimeOff: the time off as saved, and the bookings it overlaps
        - None: chair_id isn't one of the caller's current chairs. Route turns this
          into a 404.

    Raises:
        - NotSignedIn: PostgREST rejected the token
        - DatabaseUnavailable: a query failed, a row didn't match its model, or the
          shop's time zone can't be resolved
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    with user_db(caller.access_token) as db:
        mine = _load_chairs(db, caller)
        chair = _held_chair(mine, chair_id)
        if mine is None or chair is None:
            logger.info("time off at a chair the caller doesn't hold: %s", chair_id)
            return None
        zone = _zone_of(chair.establishment)
        me = str(mine.id)

        saved = {s.id: s for s in _load_stretches(db, mine.id, now_utc)}
        unchanged = {
            s.id
            for s in stretches
            if s.id in saved and (s.first_day, s.last_day) == _local_days(saved[s.id], zone)
        }
        changed = [s for s in stretches if s.id in saved and s.id not in unchanged]
        dropped = sorted(str(i) for i in saved.keys() - {s.id for s in stretches})

        # Every span that stays, so a new stretch that repeats one is skipped.
        taken = {(saved[i].starts, saved[i].ends) for i in unchanged}
        taken |= {_instants(s, zone) for s in changed}
        added: list[dict] = []
        for s in stretches:
            if s.id in saved:
                continue
            span = _instants(s, zone)
            if span in taken:
                continue
            taken.add(span)
            added.append(_time_off_row(me, span))
        kept = [_time_off_row(me, _instants(s, zone)) | {"id": str(s.id)} for s in changed]

        if dropped:
            _run_as_user(
                db.table("worker_time_off")
                .delete(returning=ReturnMethod.minimal)
                .eq("worker_id", me)
                .in_("id", dropped),
                "remove time off",
            )
        if kept:
            _run_as_user(
                db.table("worker_time_off").upsert(
                    kept, on_conflict="id", returning=ReturnMethod.minimal
                ),
                "change time off",
            )
        if added:
            _run_as_user(
                db.table("worker_time_off").insert(added, returning=ReturnMethod.minimal),
                "add time off",
            )

        upcoming = _load_stretches(db, mine.id, now_utc)
        booked = _load_bookings(db, mine.id, upcoming, now_utc)

    return _to_time_off(chair.establishment, zone, now_utc, upcoming, booked)
