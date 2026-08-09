"""

"""
import httpx
import logging
from postgrest import APIError
from pydantic import ValidationError, create_model
from supabase import Client, ClientOptions, create_client
from server.core.config import settings
from server.models.supabase_models import WorkerProfile
from server.models.public_models import (
    to_public, 
    WorkerProfilePublic,

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


# The SELECT list is the public model's field list, so the query can never pull a
# column the response would have dropped anyway - notably user_id.
_SELECT_WORKER_PROFILE = ", ".join(WorkerProfilePublic.model_fields)


def get_worker_by_slug(slug: str) -> WorkerProfilePublic | None:
    """
    Look up one barber's public profile by their booking-page slug.

    Args:
        - slug (str): unique slug from the booking URL

    Returns:
        - dict of the worker_profile row, or None if no active barber matches.

    Raises:
        - DatabaseUnavailable: the query itself failed (network, bad policy,
          schema drift). Distinct from "no such barber", which is None.
    """
    try:
        resp = (
            public_db.table("worker_profile")
            .select(_SELECT_WORKER_PROFILE)
            .eq("slug", slug)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except (APIError, httpx.HTTPError) as exc:
        # Logged server-side in full; the route turns this into a bare 503.
        logger.exception("worker_profile lookup failed for slug=%r", slug)
        raise DatabaseUnavailable(str(exc)) from exc

    if not resp.data:
        logger.info("Someone requested slug that does not exist %s", slug)
        return None

    try:
        row = to_public(WorkerProfilePublic, resp.data[0])

    except ValidationError as exc:
        # The row does not match the generated schema - the table changed under
        # us. Refuse to serve it rather than pass unvalidated data outward.
        logger.exception("worker_profile row failed validation for slug=%r", slug)
        raise DatabaseUnavailable("schema mismatch") from exc

    return row