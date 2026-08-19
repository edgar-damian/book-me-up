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

    """
    dates: list[date]

# --------------- Everything downstream is from  public_models.py

class Status(StrEnum):
    PENDING = 'PENDING'
    ACCEPTED = 'ACCEPTED'
    REJECTED = 'REJECTED'
    CANCELLED = 'CANCELLED'
    COMPLETED = 'COMPLETED'
    NO_SHOW = 'NO_SHOW'


class CancelledBy(StrEnum):
    CLIENT = 'CLIENT'
    WORKER = 'WORKER'
    SYSTEM = 'SYSTEM'


class Service(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    worker_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
    )
    title: str
    description: str
    image: str | None = None
    price_cents: int
    duration_min: int
    buffer_after_min: int
    is_active: bool
    created_at: AwareDatetime
    updated_at: AwareDatetime



class WorkerScheduleDay(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    worker_establishment_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `worker_establishment.id`.<fk table='worker_establishment' column='id'/>",
    )
    day_of_week: int
    start_minute: int
    end_minute: int
    break_start_minute: int | None = None
    break_end_minute: int | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class WorkerProfile(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    user_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `app_user.id`.<fk table='app_user' column='id'/>",
    )
    slug: str
    first_name: str
    last_name: str
    bio: str
    public_email: str | None = None
    public_phone: str | None = None
    image: str | None = None
    is_active: bool
    hold_expiry_hours: int
    auto_accept: bool
    min_lead_time_min: int
    max_advance_days: int
    cancellation_cutoff_min: int
    created_at: AwareDatetime
    updated_at: AwareDatetime


class Establishment(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    slug: str
    name: str
    address: str
    city: str
    state: str
    zip: str
    lat: float | None = None
    lng: float | None = None
    timezone: str
    phone: str | None = None
    email: str | None = None
    hours: Any | None = None
    description: str
    images: list[str]
    is_active: bool
    created_at: AwareDatetime
    updated_at: AwareDatetime


class Appointment(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    worker_establishment_id: UUID
    establishment_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `establishment.id`.<fk table='establishment' column='id'/>",
    )
    worker_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
    )
    service_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `service.id`.<fk table='service' column='id'/>",
    )
    client_id: UUID | None = Field(
        None,
        description="Note:\nThis is a Foreign Key to `client.id`.<fk table='client' column='id'/>",
    )
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    block_ends_at: AwareDatetime
    service_title: str
    price_cents: int
    duration_min: int
    buffer_after_min: int
    status: Status
    cancelled_by: CancelledBy | None = None
    hold_expires_at: AwareDatetime | None = None
    client_name: str
    client_phone: str
    client_email: str | None = None
    client_notes: str | None = None
    cancelled_at: AwareDatetime | None = None
    cancellation_reason: str | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime

class WorkerTimeOff(BaseModel):
    id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
    worker_id: UUID = Field(
        ...,
        description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
    )
    starts: AwareDatetime
    ends: AwareDatetime
    reason: str | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime
