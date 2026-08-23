"""
Includes classes used in the booking flow. There are 
3 steps to the flow as follows: 
    1) User already picked a Service from a Worker. They need to get shown 
        a calendar with days available.
    2) User picks a day, then they must get shown a list of slots that are
        available for this given service.
    3) User picks a date with a time. This needs to get posted on the db 
        so Workers can see it and clients get that slot as unavailable.
"""

from __future__ import annotations

from typing import Any
from pydantic import AwareDatetime, BaseModel, Field, RootModel, ConfigDict
from uuid import UUID
from enum import StrEnum 
from datetime import date


class DatesAvailable(BaseModel):
    """
    Dates on which at least one bookable slot exists for a given service.
    """
    timezone: str = Field(
        description="Timezone of the establishment."
    )
    window_start: date = Field(
        description="now -> worker_profile.min_lead_time_min (default of 60 min)"
    )
    window_end: date = Field(
        description="today -> worker_profile.max_advance_days (default of 60 days)"
    )
    dates: list[date] = Field(
        description="list of dates available"
    )


class TimesAvailable(BaseModel):
    """
    Step 2 of the booking flow, a client picked a date. We now
    show them a list of ValidSlots for them to choose form.
    """
    class ValidSlot(BaseModel):
        """
        One bookable appointment, as absolute instants. `end_time` is the
        client-facing end (start + duration_min)
        """

        start_time: AwareDatetime
        end_time: AwareDatetime

    timezone: str = Field(
        description="Timezone of the establishment."
    )
    day_chose: date = Field(
        description="The day chosen by the user"
    )
    valid_slots: list[ValidSlot] = Field(
        description="List of slots with a start and end time"
    )


class BookingStatus(StrEnum):
    """
    What a brand new booking can be. ACCEPTED when the worker auto accepts,
    otherwise PENDING until they answer.
    """
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"


class BookAppointment(BaseModel):
    """
    Step 3 of the booking, a client will build this and hand this
    to us. We then make to make the Appointment row to save their spot
    """
    class Client(BaseModel):
        """
        What the booking form collects. No id on purpose, guests never get a
        Client row and linking one is ours to decide, not the caller's.
        """
        first_name: str
        last_name: str
        phone: str = Field(
            description="E.164", pattern=r"^\+[1-9][0-9]{1,14}$"
        )
        email: str | None = None

    client: Client
    starts_at: AwareDatetime = Field(
        description="The slot the client picked in step 2"
    )
    notes: str | None = Field(
        default=None, description="Client authored, this booking only"
    )
    service_id: UUID
    worker_id: UUID
    establishment_id: UUID


class AppointmentBooked(BaseModel):
    """
    Step 3 result, what actually got saved. The frontend keys its message off
    status: ACCEPTED is booked, PENDING is held until hold_expires_at.
    """
    id: UUID
    status: BookingStatus
    timezone: str = Field(
        description="Timezone of the establishment."
    )
    starts_at: AwareDatetime
    ends_at: AwareDatetime = Field(
        description="Client facing end, no buffer"
    )
    service_title: str
    price_cents: int
    hold_expires_at: AwareDatetime | None = Field(
        default=None, description="Only set while PENDING"
    )