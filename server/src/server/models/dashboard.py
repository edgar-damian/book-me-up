"""
Bodies and responses for the worker dashboard. Everything here is the caller's
own data, read and written as the caller so RLS applies.
"""

from typing import Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

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
