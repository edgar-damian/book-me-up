"""
Includes functions and queries used in the booking flow. There are
3 steps to the flow as follows:
    1) User already picked a Service from a Worker. They need to get shown
        a calendar with days available.
    2) User picks a day, then they must get shown a list of slots that are
        available for this given service.
    3) User picks a date with a time. This needs to get posted on the db
        so Workers can see it and clients get that slot as unavailable.

Timezone arithmetic is always computed in UTC
"""

import logging
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from postgrest import APIError
from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from server.supabase.injection_cleaning import injection_cleaning
from server.models.booking import (
    AppointmentBooked,
    BookAppointment,
    BookingStatus,
    DatesAvailable,
    TimesAvailable,
)
from server.supabase.injection_cleaning import injection_cleaning
from server.supabase.sb_function import (
    DatabaseUnavailable,
    _run,
    _cols,
    admin_db,
    public_db
)

logger = logging.getLogger(__name__)

_GRID_MIN = 15 # show time slots in 15 min intervals

# triggered when the slot went to someone else mid flow 
_EXCLUSION_VIOLATION = "23P01" 

# Caps on anything the caller sends us, applied after scrubbing.
_NAME_CAP = 100
_EMAIL_CAP = 254
_PHONE_CAP = 16
_NOTES_CAP = 1000
_E164 = re.compile(r"\+[1-9][0-9]{1,14}")

# Order handed to injection_cleaning, and what its [index] reasons refer to.
_SCANNED_FIELDS = ("first_name", "last_name", "phone", "email", "notes")

_BusyInterval = tuple[datetime, datetime] # Aware instants, half-open [start, end).


class SlotTaken(RuntimeError):
    """Someone booked this slot first. Route turns this into a 409, not a 503."""


def _run_write(query, what: str):
    """
    _run, but tells a lost race apart from a real failure.

    Args:
        - query: the PostgREST query to execute
        - what (str): label for the log line

    Returns:
        - The PostgREST response

    Raises:
        - SlotTaken: the exclusion constraint rejected the insert
        - DatabaseUnavailable: anything else
    """
    try:
        return query.execute()
    except APIError as exc:
        if exc.code == _EXCLUSION_VIOLATION:
            logger.info("%s lost the race for the slot", what)
            raise SlotTaken(str(exc)) from exc
        logger.exception("%s query failed", what)
        raise DatabaseUnavailable(str(exc)) from exc
    except httpx.HTTPError as exc:
        logger.exception("%s query failed", what)
        raise DatabaseUnavailable(str(exc)) from exc


class _ScheduleDay(BaseModel):
    model_config = ConfigDict(extra="ignore")

    day_of_week: int  # 0 = Sunday ... 6 = Saturday (DB convention)
    start_minute: int  # wall-clock minutes from local midnight
    end_minute: int
    break_start_minute: int | None = None
    break_end_minute: int | None = None


class _ChairContext(BaseModel):
    """One worker_establishment row with everything step 1 needs embedded."""

    model_config = ConfigDict(extra="ignore")

    class Establishment(BaseModel):
        model_config = ConfigDict(extra="ignore")

        timezone: str

    class Policy(BaseModel):
        model_config = ConfigDict(extra="ignore")

        min_lead_time_min: int
        max_advance_days: int
        auto_accept: bool
        hold_expiry_hours: int

    id: UUID
    establishment: Establishment
    worker_profile: Policy
    schedule_days: list[_ScheduleDay]


class _ServiceTiming(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    price_cents: int
    duration_min: int
    buffer_after_min: int


class _InsertedAppointment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    status: str
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    hold_expires_at: AwareDatetime | None = None


class _BusyAppointment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    starts_at: AwareDatetime
    block_ends_at: AwareDatetime


class _BusyTimeOff(BaseModel):
    model_config = ConfigDict(extra="ignore")

    starts: AwareDatetime
    ends: AwareDatetime


_CHAIR_CONTEXT_COLS = _cols(
    _ChairContext,
    establishment=f"establishment:establishment!inner({_cols(_ChairContext.Establishment)})",
    worker_profile=f"worker_profile:worker_profile!inner({_cols(_ChairContext.Policy)})",
    schedule_days=f"schedule_days:worker_schedule_day({_cols(_ScheduleDay)})",
)
_SERVICE_TIMING_COLS = _cols(_ServiceTiming)
_BUSY_APPOINTMENT_COLS = _cols(_BusyAppointment)
_BUSY_TIME_OFF_COLS = _cols(_BusyTimeOff)


def _minute_to_instant(day: date, minute: int, zone: ZoneInfo) -> datetime:
    """
    Wall-clock minute of a local day -> absolute UTC instant.
    """
    return (datetime.combine(day, time(0), tzinfo=zone) + timedelta(minutes=minute)).astimezone(UTC)


def _open_intervals(sched: _ScheduleDay) -> list[tuple[int, int]]:
    """
    The day's open wall-clock windows [start, end) minus the optional break.

    Args:
        - sched (_ScheduleDay): The max open ness a worker has in their day 
    
    Returns:
        - A list of [Start_minute, end_minute)
    """
    if sched.break_start_minute is None:
        return [(sched.start_minute, sched.end_minute)]
    windows = [
        (sched.start_minute, sched.break_start_minute),
        (sched.break_end_minute, sched.end_minute),
    ]
    return [(lo, hi) for lo, hi in windows if lo < hi]


def _iter_day_slots(
    day: date,
    sched: _ScheduleDay,
    zone: ZoneInfo,
    slot_min: int,
    lead_instant: datetime,
    busy: list[_BusyInterval],
) -> Iterator[datetime]:
    """
    Every bookable start on `day`, ascending, as absolute UTC instants.

    The single definition of "bookable" in this flow: step 1 asks whether this
    yields anything, step 2 lists it, step 3 validates a posted start against
    it.  Keeping all three on one generator is what stops the calendar from
    advertising a day the slot list can't fill.

    Lazy on purpose -- step 1's short-circuit costs nothing because the loop
    stops at the first survivor.

    Args:
        - day (date): local calendar day in `zone`
        - sched (_ScheduleDay): that weekday's hours for this chair
        - zone (ZoneInfo): the establishment's timezone
        - slot_min (int): duration + buffer, i.e. what actually occupies the chair
        - lead_instant (datetime): earliest bookable instant (min_lead_time_min)
        - busy (list[_BusyInterval]): appointments and time off to avoid

    Yields:
        Slot start instants in UTC, ascending.
    """
    for lo, hi in _open_intervals(sched):
        first = ((lo + _GRID_MIN - 1) // _GRID_MIN) * _GRID_MIN  # ceil to grid
        for m in range(first, hi - slot_min + 1, _GRID_MIN):
            s = _minute_to_instant(day, m, zone)
            if s < lead_instant:
                continue
            e = s + timedelta(minutes=slot_min)  # UTC arithmetic: real elapsed time
            if any(s < b_end and e > b_start for b_start, b_end in busy):
                continue
            yield s


def _day_has_slot(
    day: date,
    sched: _ScheduleDay,
    zone: ZoneInfo,
    slot_min: int,
    lead_instant: datetime,
    busy: list[_BusyInterval],
) -> bool:
    """
    True if the day holds at least one valid slot for an appointment.

    Returns:
        True if at least one slot is valid, False otherwise
    """
    return next(_iter_day_slots(day, sched, zone, slot_min, lead_instant, busy), None) is not None


@dataclass(frozen=True)
class _Context:
    """
    Everything both steps need before any slot math runs: where the chair is,
    when it is open, how long the service occupies it, and how far out the
    worker's policy allows booking.
    """

    chair_id: UUID
    tz: str
    zone: ZoneInfo
    by_dow: dict[int, _ScheduleDay]
    service_title: str
    price_cents: int
    duration_min: int  # client-facing length
    buffer_after_min: int
    slot_min: int  # duration + buffer -- what actually occupies the chair
    auto_accept: bool
    hold_expiry_hours: int
    lead_instant: datetime
    window_start: date
    window_end: date


def _load_context(
    establishment_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    now_utc: datetime,
) -> _Context | None:
    """
    Reads 1 and 2, shared by every step of the booking flow.

    Args:
        - establishment_id (UUID): the shop
        - worker_id (UUID): the barber
        - service_id (UUID): the service being booked
        - now_utc (datetime): aware instant the policy window is measured from

    Returns:
        - _Context on success
        - None: no active chair for this worker at this shop, or no such active
          service for this worker.  Callers turn this into a 404.

    Raises:
        - DatabaseUnavailable: query failure, a row that no longer matches the
          model, or an establishment timezone this box cannot resolve.
    """
    chair_resp = _run(
        public_db.table("worker_establishment")
        .select(_CHAIR_CONTEXT_COLS)
        .eq("worker_id", str(worker_id))
        .eq("establishment_id", str(establishment_id))
        .eq("is_active", True)
        .eq("establishment.is_active", True)
        .eq("worker_profile.is_active", True)
        .limit(1),
        "chair context",
    )
    if not chair_resp.data:
        logger.info("no active chair for worker=%s establishment=%s", worker_id, establishment_id)
        return None

    service_resp = _run(
        public_db.table("service")
        .select(_SERVICE_TIMING_COLS)
        .eq("id", str(service_id))
        .eq("worker_id", str(worker_id))
        .eq("is_active", True)
        .limit(1),
        "service timing",
    )
    if not service_resp.data:
        logger.info("no active service=%s for worker=%s", service_id, worker_id)
        return None

    try:
        chair = _ChairContext.model_validate(chair_resp.data[0])
        svc = _ServiceTiming.model_validate(service_resp.data[0])
    except ValidationError as exc:
        logger.exception("booking rows failed validation for worker=%s", worker_id)
        raise DatabaseUnavailable("schema mismatch") from exc

    tz = chair.establishment.timezone
    try:
        zone = ZoneInfo(tz)
    except ZoneInfoNotFoundError as exc:
        logger.exception("establishment=%s has unusable timezone %r", establishment_id, tz)
        raise DatabaseUnavailable("bad timezone") from exc

    # Policy window, in the shop's local calendar.
    policy = chair.worker_profile
    lead_instant = now_utc + timedelta(minutes=policy.min_lead_time_min)

    return _Context(
        chair_id=chair.id,
        tz=tz,
        zone=zone,
        by_dow={s.day_of_week: s for s in chair.schedule_days},
        service_title=svc.title,
        price_cents=svc.price_cents,
        duration_min=svc.duration_min,
        buffer_after_min=svc.buffer_after_min,
        slot_min=svc.duration_min + svc.buffer_after_min,
        auto_accept=policy.auto_accept,
        hold_expiry_hours=policy.hold_expiry_hours,
        lead_instant=lead_instant,
        window_start=lead_instant.astimezone(zone).date(),
        window_end=now_utc.astimezone(zone).date() + timedelta(days=policy.max_advance_days),
    )


def _fetch_busy(worker_id: UUID, lo_utc: datetime, hi_utc: datetime) -> list[_BusyInterval]:
    """
    Reads 3 and 4: everything occupying this worker that overlaps [lo_utc, hi_utc).

    Keyed on worker_id rather than the chair, because the double-booking
    constraint is per-person -- an appointment at their other shop blocks this
    one too.  Appointments contribute block_ends_at, not ends_at: the buffer is
    part of what is occupied.  Half-open, so a row ending exactly at lo_utc
    does not count as overlapping.

    Args:
        - worker_id (UUID): the barber, across every shop they work
        - lo_utc (datetime): window start, aware
        - hi_utc (datetime): window end, aware, exclusive

    Returns:
        Busy intervals as (start, end) pairs of aware instants.

    Raises:
        - DatabaseUnavailable: query failure or a row that failed validation.
    """
    appt_resp = _run(
        public_db.table("appointment_busy")
        .select(_BUSY_APPOINTMENT_COLS)
        .eq("worker_id", str(worker_id))
        .lt("starts_at", hi_utc.isoformat())
        .gt("block_ends_at", lo_utc.isoformat()),
        "appointment busy",
    )
    off_resp = _run(
        public_db.table("worker_time_off_busy")
        .select(_BUSY_TIME_OFF_COLS)
        .eq("worker_id", str(worker_id))
        .lt("starts", hi_utc.isoformat())
        .gt("ends", lo_utc.isoformat()),
        "time off busy",
    )

    try:
        return [
            (a.starts_at, a.block_ends_at)
            for a in (_BusyAppointment.model_validate(r) for r in appt_resp.data)
        ] + [(t.starts, t.ends) for t in (_BusyTimeOff.model_validate(r) for r in off_resp.data)]
    except ValidationError as exc:
        logger.exception("busy rows failed validation for worker=%s", worker_id)
        raise DatabaseUnavailable("schema mismatch") from exc


def get_dates(
    establishment_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    *,
    now_utc: datetime | None = None,
) -> DatesAvailable | None:
    """
    Step 1, a clients chooses a service and a worker. This function returns 
    a list of dates available for their given service.

    Args:
        - establishment_id (UUID): the shop
        - worker_id (UUID): the barber
        - service_id (UUID): the service being booked
        - now_utc (datetime | None): override for the current instant

    Returns:
        - DatesAvailable (dates may be empty -- fully booked is still a 200)
        - None: no active chair/worker/establishment, or no such active service
          for this worker.  Route turns this into a 404.

    Raises:
        - DatabaseUnavailable: query failure, row that no longer matches the
          model, or an unusable establishment timezone.  Route turns this into
          a 503; detail goes to logs.
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    ctx = _load_context(establishment_id, worker_id, service_id, now_utc)
    if ctx is None:
        return None

    if ctx.window_start > ctx.window_end:  # lead time reaches past the advance limit
        return DatesAvailable(
            timezone=ctx.tz, window_start=ctx.window_start, window_end=ctx.window_end, dates=[]
        )

    # Busy fetch bounds: [local midnight of window_start, midnight after window_end).
    busy = _fetch_busy(
        worker_id,
        _minute_to_instant(ctx.window_start, 0, ctx.zone),
        _minute_to_instant(ctx.window_end + timedelta(days=1), 0, ctx.zone),
    )

    dates: list[date] = []
    day = ctx.window_start
    while day <= ctx.window_end:
        sched = ctx.by_dow.get((day.weekday() + 1) % 7)  # makes sun=0, sat=6
        if sched is not None and _day_has_slot(
            day, sched, ctx.zone, ctx.slot_min, ctx.lead_instant, busy
        ):
            dates.append(day)
        day += timedelta(days=1)

    return DatesAvailable(
        timezone=ctx.tz, window_start=ctx.window_start, window_end=ctx.window_end, dates=dates
    )


def get_times(
    establishment_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    day: date,
    *,
    now_utc: datetime | None = None,
) -> TimesAvailable | None:
    """
    Step 2.  Every bookable slot on one already-chosen local date.

    Same four reads as step 1, but the busy fetch covers a single day instead
    of the whole window.  That is the point: fewer rows and a fresher read
    shrink the gap between rendering a slot and the client posting it back.
    Nothing here is cached.

    Being straight about the limit -- this cannot make the slot list
    race-proof.  Someone can take a slot between this response and the step 3
    POST.  The exclusion constraint appointment_no_double_booking is the actual
    guard; step 3 should map SQLSTATE 23P01 to a 409 rather than a 503.

    Args:
        - establishment_id (UUID): the shop
        - worker_id (UUID): the barber
        - service_id (UUID): the service being booked
        - day (date): the local calendar date the user picked in step 1
        - now_utc (datetime | None): override for the current instant

    Returns:
        - TimesAvailable (valid_slots may be empty -- a closed or fully booked
          day is still a 200, matching step 1 returning dates=[])
        - None: no active chair/worker/establishment, or no such active service
          for this worker.  Route turns this into a 404.

    Raises:
        - DatabaseUnavailable: query failure, row that no longer matches the
          model, or an unusable establishment timezone.  Route turns this into
          a 503; detail goes to logs only.
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    ctx = _load_context(establishment_id, worker_id, service_id, now_utc)
    if ctx is None:
        return None

    empty = TimesAvailable(timezone=ctx.tz, day_chose=day, valid_slots=[])

    # Re-check the policy window here.  Step 1's calendar is UI, not
    # enforcement -- a stale tab or a hand-typed date would otherwise book
    # past max_advance_days or inside min_lead_time_min.
    if not (ctx.window_start <= day <= ctx.window_end):
        logger.info("day=%s outside policy window for worker=%s", day, worker_id)
        return empty

    sched = ctx.by_dow.get((day.weekday() + 1) % 7)  # makes sun=0, sat=6
    if sched is None:  # chair is closed that weekday
        return empty

    # One local day, midnight to midnight.  The overlap filters in _fetch_busy
    # still catch an appointment that starts the evening before and runs in.
    busy = _fetch_busy(
        worker_id,
        _minute_to_instant(day, 0, ctx.zone),
        _minute_to_instant(day + timedelta(days=1), 0, ctx.zone),
    )

    slots = [
        TimesAvailable.ValidSlot(start_time=s, end_time=s + timedelta(minutes=ctx.duration_min))
        for s in _iter_day_slots(day, sched, ctx.zone, ctx.slot_min, ctx.lead_instant, busy)
    ]
    return TimesAvailable(timezone=ctx.tz, day_chose=day, valid_slots=slots)


def _clean(value: object, cap: int) -> str:
    """
    Scrub one caller supplied string. Coerces to str, folds compatibility and
    homoglyph forms, drops every unicode C* char (control, zero-width, bidi
    override, surrogate, unassigned), collapses whitespace, then hard caps.
    """
    s = unicodedata.normalize("NFKC", str(value))
    s = "".join(c for c in s if c == " " or not unicodedata.category(c).startswith("C"))
    return " ".join(s.split())[:cap]


def _named_reasons(reasons: list[str] | None) -> str:
    """Swap injection_cleaning's positional [0] for the field it came from."""
    if not reasons:
        return "unknown"
    out = []
    for r in reasons:
        for i, field in enumerate(_SCANNED_FIELDS):
            if r.startswith(f"[{i}]"):
                out.append(f"{field}{r.split(']', 1)[1]}")
                break
        else:
            out.append(r)
    return "; ".join(out)


def _clean_email(value: object) -> str | None:
    """Cheap shape check. A junk address is dropped, it never fails the booking."""
    s = _clean(value, _EMAIL_CAP).lower()
    if s.count("@") != 1:
        return None
    local, _, domain = s.partition("@")
    return s if local and "." in domain else None    


def make_appointment(
    apt: BookAppointment,
    *,
    now_utc: datetime | None = None,
) -> AppointmentBooked | None:
    """
    Step 3, the user chose a day and time. Nothing the caller sent is trusted:
    every string is scrubbed, and the slot, price and duration are re-derived
    from the database before the row is written.

    Args:
        - apt (BookAppointment): object built and handed to us by the user
        - now_utc (datetime | None): override for the current instant

    Returns:
        - AppointmentBooked on success
        - None: unusable client details, or no active chair/service. Route
          turns this into a 404.

    Raises:
        - SlotTaken: the slot is not one we offer, or someone booked it first.
          Route turns this into a 409.
        - DatabaseUnavailable: query failure or a row that failed validation.
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

    # run a basic clean function
    first_name = _clean(apt.client.first_name, _NAME_CAP)
    last_name = _clean(apt.client.last_name, _NAME_CAP)
    phone = _clean(apt.client.phone, _PHONE_CAP)
    email = _clean_email(apt.client.email) if apt.client.email is not None else None
    notes = _clean(apt.notes, _NOTES_CAP) or None if apt.notes is not None else None

    # Second pass: reject outright anything nobody types by hand, defang the
    # rest. Order matters -- this rewrites the strings, so the checks below run
    # on what actually gets stored, not on what arrived.
    ok, reasons, cleaned = injection_cleaning([first_name, last_name, phone, email or "", notes or ""])
    if not ok:
        logger.warning(
            "rejected booking for worker=%s, hostile input in %s",
            apt.worker_id,
            _named_reasons(reasons),
        )
        return None
    first_name, last_name, phone, email, notes = cleaned
    email = email or None
    notes = notes or None

    if not first_name or not _E164.fullmatch(phone):
        logger.info("rejected booking with unusable client details")
        return None

    ctx = _load_context(apt.establishment_id, apt.worker_id, apt.service_id, now_utc)
    if ctx is None:
        return None

    starts_at = apt.starts_at.astimezone(UTC)
    day = starts_at.astimezone(ctx.zone).date()

    if not (ctx.window_start <= day <= ctx.window_end):
        raise SlotTaken(f"{starts_at.isoformat()} is outside the booking window")

    sched = ctx.by_dow.get((day.weekday() + 1) % 7)  # makes sun=0, sat=6
    if sched is None:
        raise SlotTaken(f"{day} is not a working day for this chair")

    busy = _fetch_busy(
        apt.worker_id,
        _minute_to_instant(day, 0, ctx.zone),
        _minute_to_instant(day + timedelta(days=1), 0, ctx.zone),
    )


    offered = set(_iter_day_slots(day, sched, ctx.zone, ctx.slot_min, ctx.lead_instant, busy))
    if starts_at not in offered:
        raise SlotTaken(f"{starts_at.isoformat()} is not a slot we offer")

    status = BookingStatus.ACCEPTED if ctx.auto_accept else BookingStatus.PENDING
    hold_expires_at = (
        None
        if status is BookingStatus.ACCEPTED
        else now_utc + timedelta(hours=ctx.hold_expiry_hours)
    )

    # Every value here is either server read or scrubbed
    row = {
        "worker_establishment_id": str(ctx.chair_id),
        "establishment_id": str(apt.establishment_id),
        "worker_id": str(apt.worker_id),
        "service_id": str(apt.service_id),
        "client_id": None,
        "starts_at": starts_at.isoformat(),
        "service_title": ctx.service_title,
        "price_cents": ctx.price_cents,
        "duration_min": ctx.duration_min,
        "buffer_after_min": ctx.buffer_after_min,
        "status": str(status),
        "client_name": f"{first_name} {last_name}".strip(),
        "client_phone": phone,
        "client_email": email,
        "client_notes": notes,
        "hold_expires_at": hold_expires_at.isoformat() if hold_expires_at else None,
    }

    # NOTE: uses anon key 
    resp = _run_write(admin_db.table("appointment").insert(row), "appointment insert")
    if not resp.data:
        raise DatabaseUnavailable("insert returned no row")

    try:
        saved = _InsertedAppointment.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("inserted appointment failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc

    return AppointmentBooked(
        id=saved.id,
        status=saved.status,
        timezone=ctx.tz,
        starts_at=saved.starts_at,
        ends_at=saved.ends_at,
        service_title=ctx.service_title,
        price_cents=ctx.price_cents,
        hold_expires_at=saved.hold_expires_at,
    )