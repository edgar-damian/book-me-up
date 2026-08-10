"""
Response shapes for the public API.

These are the enforcement point for what leaves the server. FastAPI filters
every response through the declared `response_model`, so a column accidentally
added to a SELECT cannot reach a client unless it is also declared here.
Returning a bare dict from a route bypasses that - don't.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


def to_public[P: BaseModel](public_model: type[P], row: object) -> P:
    """Project a raw table row onto its public model. Fields match by name;
    anything the public model does not declare is never read."""
    return public_model.model_validate(row, from_attributes=True)


class WorkerLandingPage(BaseModel):
    """
    Object is used to make a landing page dedicated for each worker
    """
    class Services(BaseModel):
        model_config = ConfigDict(extra="ignore")

        id: UUID
        worker_id: UUID
        title: str
        description: str
        image: str | None = None
        price_cents: int
        duration_min: int
        is_active: bool

    class Chair(BaseModel):
        """
        A worker has one Chair object per location they work in 
        """
        class Establishment(BaseModel):
            model_config = ConfigDict(extra="ignore")
            id: UUID
            slug: str
            name: str
            city: str
            timezone: str

        class Day(BaseModel):
            model_config = ConfigDict(extra="ignore")
            day_of_week: int
            start_minute: int
            end_minute: int

        model_config = ConfigDict(extra="ignore")
        id: UUID
        establishment: Establishment
        schedule_days: list[Day]


    model_config = ConfigDict(extra="ignore")

    id: UUID
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

    services: list[Services]
    chairs: list[Chair]
    


class EstablishmentLandingPage(BaseModel):
    """
    Object is used to render a landing page of a shop/establishment
    """

    class Workers(BaseModel):
        model_config = ConfigDict(extra="ignore")

        id: UUID
        slug: str
        first_name: str
        last_name: str
        bio: str
        image: str | None = None
        is_active: bool
        
    model_config = ConfigDict(extra="ignore")
    
    id: UUID
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
    workers: list[Workers]


# class Client(BaseModel):
#     id: UUID
#     phone: str
#     email: str | None = None
#     display_name: str
#     user_id: UUID | None 


# class EstablishmentOwner(BaseModel):
#     id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
#     user_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `app_user.id`.<fk table='app_user' column='id'/>",
#     )
#     establishment_id: UUID
#     can_manage_billing: bool
#     created_at: AwareDatetime


# class Service(BaseModel):
#     model_config = ConfigDict(extra="ignore")

#     id: UUID
#     worker_id: UUID
#     title: str
#     description: str
#     image: str | None = None
#     price_cents: int
#     duration_min: int
#     buffer_after_min: int
#     is_active: bool


# class WorkerScheduleDay(BaseModel):
#     model_config = ConfigDict(extra="ignore")

#     id: UUID 
#     worker_establishment_id: UUID
#     day_of_week: int
#     start_minute: int
#     end_minute: int
#     break_start_minute: int | None = None
#     break_end_minute: int | None = None


# class ClientNote(BaseModel):
#     id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
#     client_id: UUID | None = Field(
#         None,
#         description="Note:\nThis is a Foreign Key to `client.id`.<fk table='client' column='id'/>",
#     )
#     client_phone: str
#     client_email: str | None = None
#     worker_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
#     )
#     body: str
#     created_at: AwareDatetime
#     updated_at: AwareDatetime


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


# class Appointment(BaseModel):
#     id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
#     worker_establishment_id: UUID
#     establishment_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `establishment.id`.<fk table='establishment' column='id'/>",
#     )
#     worker_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
#     )
#     service_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `service.id`.<fk table='service' column='id'/>",
#     )
#     client_id: UUID | None = Field(
#         None,
#         description="Note:\nThis is a Foreign Key to `client.id`.<fk table='client' column='id'/>",
#     )
#     starts_at: AwareDatetime
#     ends_at: AwareDatetime
#     block_ends_at: AwareDatetime
#     service_title: str
#     price_cents: int
#     duration_min: int
#     buffer_after_min: int
#     status: Status
#     cancelled_by: CancelledBy | None = None
#     hold_expires_at: AwareDatetime | None = None
#     client_name: str
#     client_phone: str
#     client_email: str | None = None
#     client_notes: str | None = None
#     cancelled_at: AwareDatetime | None = None
#     cancellation_reason: str | None = None
#     created_at: AwareDatetime
#     updated_at: AwareDatetime


# class WorkerTimeOff(BaseModel):
#     id: UUID = Field(..., description='Note:\nThis is a Primary Key.<pk/>')
#     worker_id: UUID = Field(
#         ...,
#         description="Note:\nThis is a Foreign Key to `worker_profile.id`.<fk table='worker_profile' column='id'/>",
#     )
#     starts: AwareDatetime
#     ends: AwareDatetime
#     reason: str | None = None
#     created_at: AwareDatetime
#     updated_at: AwareDatetime


class WorkerEstablishmentPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID 
    worker_id: UUID
    establishment_id: UUID
    is_active: bool


# class AppUser(BaseModel):
#     id: UUID
#     email: str | None = None
#     first_name: str
#     last_name: str
#     phone: str | None = None
#     is_platform_admin: bool
#     created_at: AwareDatetime
#     updated_at: AwareDatetime
