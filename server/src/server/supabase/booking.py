"""
Includes functions and queries used in the booking flow. There are
3 steps to the flow as follows:
    1) User already picked a Service from a Worker. They need to get shown
        a calendar with days available.
    2) User picks a day, then they must get shown a list of slots that are
        available for this given service.
    3) User picks a date with a time. This needs to get posted on the db
        so Workers can see it and clients get that slot as unavailable.

Timezone conventions (see docs/schema.md "Availability is computed, never stored"):
- worker_schedule_day minutes are wall-clock, local to establishment.timezone.
  A 9:00 shift means 9:00 on the wall even on a DST-transition day, so slot
  *starts* are computed with wall-clock arithmetic (aware datetime + timedelta,
  fold=0 resolves gap/repeat hours deterministically).
- A slot's occupied *end* is real elapsed time, so it is computed in UTC.
  Wall-clock end arithmetic would be off by an hour across a DST transition.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from postgrest import APIError
from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from server.models.booking import DatesAvailable, TimesAvailable
from server.supabase.sb_function import (
    DatabaseUnavailable, 
    _run,
    _cols, 
    public_db
)

logger = logging.getLogger(__name__)

_GRID_MIN = 15 # show time slots in 15 min intervals

_BusyInterval = tuple[datetime, datetime] # Aware instants, half-open [start, end).


class _ScheduleDay(BaseModel):
    model_config = ConfigDict(extra="ignore")

    day_of_week: int  # 0 = Sunday .. 6 = Saturday (DB convention)
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

    establishment: Establishment
    worker_profile: Policy
    schedule_days: list[_ScheduleDay]


class _ServiceTiming(BaseModel):
    model_config = ConfigDict(extra="ignore")

    duration_min: int
    buffer_after_min: int


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


def _day_has_slot(
    day: date,
    sched: _ScheduleDay,
    zone: ZoneInfo,
    slot_min: int,
    lead_instant: datetime,
    busy: list[_BusyInterval],
) -> bool:
    """
    True if the day holds at least one valid slot for an appointment

    Args:
        - day:
        - sched:
        - zone:
        - slot_min
        - lead_instant
        - busy (list[_BusyInterval]): list of busy timeslots

    Returns:
        True if at least one slot is valid, False otherwise
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
            return True
    return False


def get_dates(
    establishment_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    *,
    now_utc: datetime | None = None,
) -> DatesAvailable | None:
    """
    Which local dates have at least one bookable slot for this service at this
    chair (the active worker_establishment for worker @ establishment).

    Four reads on public_db, then pure math:
      1. chair + establishment timezone + booking policy + schedule days
      2. the service's duration/buffer (worker_id filter is load-bearing --
         it stops one worker's service being priced against another's chair)
      3. appointment_busy   -- by worker_id, NOT chair: the double-booking
         constraint is per-person, so a booking at the other shop blocks too
      4. worker_time_off_busy

    Returns:
        - DatesAvailable (dates may be empty -- fully booked is still a 200)
        - None: no active chair/worker/establishment, or no such active service
          for this worker.  Route turns this into a 404.

    Raises:
        - DatabaseUnavailable: query failure, row that no longer matches the
          model, or an unusable establishment timezone.  Route turns this into
          a 503; detail goes to logs only.
    """
    if now_utc is None:
        now_utc = datetime.now(UTC)

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
        logger.info(
            "no active chair for worker=%s establishment=%s", worker_id, establishment_id
        )
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
    window_start = lead_instant.astimezone(zone).date()
    window_end = now_utc.astimezone(zone).date() + timedelta(days=policy.max_advance_days)

    if window_start > window_end:  # lead time reaches past the advance limit
        return DatesAvailable(
            timezone=tz, window_start=window_start, window_end=window_end, dates=[]
        )

    # Busy fetch bounds: [local midnight of window_start, midnight after window_end).
    lo_utc = _minute_to_instant(window_start, 0, zone)
    hi_utc = _minute_to_instant(window_end + timedelta(days=1), 0, zone)

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
        busy: list[_BusyInterval] = [
            (a.starts_at, a.block_ends_at)
            for a in (_BusyAppointment.model_validate(r) for r in appt_resp.data)
        ] + [
            (t.starts, t.ends)
            for t in (_BusyTimeOff.model_validate(r) for r in off_resp.data)
        ]
    except ValidationError as exc:
        logger.exception("busy rows failed validation for worker=%s", worker_id)
        raise DatabaseUnavailable("schema mismatch") from exc

    by_dow = {s.day_of_week: s for s in chair.schedule_days}
    slot_min = svc.duration_min + svc.buffer_after_min

    dates: list[date] = []
    day = window_start
    while day <= window_end:
        sched = by_dow.get((day.weekday() + 1) % 7)  # makes sun=0, sat=6
        if sched is not None and _day_has_slot(day, sched, zone, slot_min, lead_instant, busy):
            dates.append(day)
        day += timedelta(days=1)

    return DatesAvailable(
        timezone=tz, window_start=window_start, window_end=window_end, dates=dates
    )


def get_times(
    establishment_id: UUID,
    worker_id: UUID,
    service_id: UUID,
    *,
    now_utc: datetime | None = None,
) -> TimesAvailable | None:
    """

    """