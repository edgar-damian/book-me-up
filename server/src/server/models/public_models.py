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

from pydantic import BaseModel, ConfigDict


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


class Status(StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"
    NO_SHOW = "NO_SHOW"


class CancelledBy(StrEnum):
    CLIENT = "CLIENT"
    WORKER = "WORKER"
    SYSTEM = "SYSTEM"


class WorkerEstablishmentPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    worker_id: UUID
    establishment_id: UUID
    is_active: bool
