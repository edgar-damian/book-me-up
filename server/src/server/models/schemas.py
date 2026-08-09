"""
Response shapes for the public API.

These are the enforcement point for what leaves the server. FastAPI filters
every response through the declared `response_model`, so a column accidentally
added to a SELECT cannot reach a client unless it is also declared here.
Returning a bare dict from a route bypasses that - don't.
"""
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BarberPublic(BaseModel):
    """A barber's public presence, sourced from worker_profile.

    Mirrors PUBLIC_WORKER_PROFILE_COLS. Nothing from app_user belongs here.
    """

    model_config = ConfigDict(extra="ignore")

    id: UUID
    slug: str
    first_name: str
    last_name: str
    bio: str | None = None
    image: str | None = None
    public_email: str | None = None
    public_phone: str | None = None

    # Booking policy - the client needs these to render a correct calendar.
    hold_expiry_hours: int
    auto_accept: bool
    min_lead_time_min: int
    max_advance_days: int
    cancellation_cutoff_min: int
