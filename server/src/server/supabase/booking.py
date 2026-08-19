"""
Includes functions and queries used in the booking flow. There are 
3 steps to the flow as follows: 
    1) User already picked a Service from a Worker. They need to get shown 
        a calendar with days available.
    2) User picks a day, then they must get shown a list of slots that are
        available for this given service.
    3) User picks a date with a time. This needs to get posted on the db 
        so Workers can see it and clients get that slot as unavailable.
"""

import logging
from uuid import UUID

import httpx
from postgrest import APIError
from pydantic import BaseModel, ValidationError
from supabase import Client, ClientOptions, create_client

from server.core.config import settings
from server.models.booking import (
    DatesAvailable,
)


logger = logging.getLogger(__name__)
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _build_client(key: str) -> Client:
    return create_client(
        settings.SUPABASE_URL,
        key,
        options=ClientOptions(httpx_client=httpx.Client(timeout=_TIMEOUT)),
    )


public_db: Client = _build_client(settings.SUPABASE_PUBLISHABLE_KEY.get_secret_value())
admin_db: Client = _build_client(settings.SUPABASE_SECRET_KEY.get_secret_value())


class DatabaseUnavailable(RuntimeError):
    """Supabase refused or failed the query. Never surfaced to the client verbatim."""


def get_dates(worker_id: UUID, service_id: UUID) -> DatesAvailable:
    """
    """