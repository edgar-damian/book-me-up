"""
Bodies and responses for the worker dashboard. Everything here is the caller's
own data, read and written as the caller so RLS applies.
"""

from datetime import date
from enum import StrEnum
from typing import Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from server.models.public_models import Status

# Same shape as the slug checks on worker_profile and establishment.
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class SaveWorkerProfile(BaseModel):
    """
    What the profile form posts. save_profile tidies the names, bio, and email.
    The slug and phone are checked here because the table's check constraints
    reject anything else, which would surface as a 503.
    """

    slug: str = Field(
        description="The end of the page's address",
        max_length=60,
        pattern=SLUG_PATTERN,
    )
    first_name: str
    last_name: str
    bio: str = ""
    public_email: str | None = None
    public_phone: str | None = Field(None, description="E.164", pattern=r"^\+[1-9][0-9]{1,14}$")


class MyWorkerProfile(BaseModel):
    """
    The caller's own worker profile, hidden or live. is_active is true once the
    page is public.
    """

    slug: str
    first_name: str
    last_name: str
    bio: str
    public_email: str | None = None
    public_phone: str | None = None
    is_active: bool


class JoinShop(BaseModel):
    """What the shop form posts: the slug of the shop the worker wants to join."""

    slug: str = Field(
        description="The end of the shop page's address",
        max_length=60,
        pattern=SLUG_PATTERN,
    )


class ScheduleDay(BaseModel):
    """
    One open day of a chair's week, in minutes from the shop's local midnight,
    with day_of_week 0 = Sunday. The checks mirror the table's, so a bad day is
    a 422 rather than a refused write.
    """

    day_of_week: int = Field(ge=0, le=6)
    start_minute: int = Field(ge=0, le=1440)
    end_minute: int = Field(ge=0, le=1440)
    break_start_minute: int | None = Field(None, ge=0, le=1440)
    break_end_minute: int | None = Field(None, ge=0, le=1440)

    @model_validator(mode="after")
    def _fits_the_day(self) -> Self:
        if self.start_minute >= self.end_minute:
            raise ValueError("A day has to end after it starts")
        if (self.break_start_minute is None) != (self.break_end_minute is None):
            raise ValueError("A break needs a start and an end")
        if self.break_start_minute is not None and not (
            self.start_minute <= self.break_start_minute < self.break_end_minute <= self.end_minute
        ):
            raise ValueError("A break has to fit inside the day")
        return self


class SaveSchedule(BaseModel):
    """What the hours form posts: the days a chair is open. A day left out is closed."""

    days: list[ScheduleDay] = Field(min_length=1, max_length=7)

    @model_validator(mode="after")
    def _one_row_per_day(self) -> Self:
        if len({d.day_of_week for d in self.days}) != len(self.days):
            raise ValueError("Each day can only appear once")
        return self


class MyChair(BaseModel):
    """
    A shop the caller works at, or has asked to join, with the hours set there.
    is_active is false until the shop's owner accepts.
    """

    class Shop(BaseModel):
        slug: str
        name: str

    id: UUID
    shop: Shop
    is_active: bool
    schedule_days: list[ScheduleDay]


class SaveService(BaseModel):
    """
    One row of the services form. id is set when the service already exists;
    save_services tidies the title and description.
    """

    id: UUID | None = None
    title: str
    description: str = ""
    price_cents: int = Field(ge=0, le=10_000_000)
    duration_min: int = Field(gt=0, le=1440)
    buffer_after_min: int = Field(0, ge=0, le=480)


class SaveServices(BaseModel):
    """
    What the services form posts: the whole menu. A saved service left out is
    turned off rather than deleted, so an appointment that points at it keeps working.
    """

    services: list[SaveService] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _each_id_once(self) -> Self:
        ids = [s.id for s in self.services if s.id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError("Each service can only appear once")
        return self


class MyService(BaseModel):
    """One of the caller's offered services, as the services form edits it."""

    id: UUID
    title: str
    description: str
    price_cents: int
    duration_min: int
    buffer_after_min: int


class MyAppointment(BaseModel):
    """
    One booking at the caller's chair, as the dashboard lists it. The fields are
    also the select list, so the client's phone, email, and notes stay unread.
    """

    id: UUID
    starts_at: AwareDatetime
    duration_min: int
    client_name: str
    service_title: str
    price_cents: int
    status: Status


class MyDay(BaseModel):
    """
    One day at a chair, in the shop's calendar. day_off is true when the chair has
    no hours that weekday, or the caller's time off covers all of them.
    """

    day: date
    day_off: bool
    appointments: list[MyAppointment]


class MyWeek(BaseModel):
    """The caller's next seven days at one chair, today first, in the shop's time zone."""

    timezone: str
    days: list[MyDay]


class Answer(StrEnum):
    """How a worker answers a booking request. Narrower than Status on purpose."""

    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class AnswerRequest(BaseModel):
    """What a request's Accept or Reject posts. Any other status is a 422."""

    status: Answer
