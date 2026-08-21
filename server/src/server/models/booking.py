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
    """
    class ValidSlot(BaseModel):
        start_time: int
        end_time: int

    timezone: str = Field(
        description="Timezone of the establishment."
    )
    day_chose: date = Field(
        description="The day chosen by the user"
    )
    valid_slots: list[ValidSlot] = Field(
        description="List of slots with a start and end time"
    )
    