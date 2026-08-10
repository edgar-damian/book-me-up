"""

"""
import httpx
import logging
from postgrest import APIError
from pydantic import ValidationError
from supabase import Client, ClientOptions, create_client
from server.core.config import settings
from server.models.public_models import (
    to_public,
    WorkerProfilePublic,
    EstablishmentPublic,
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


_WORKER_PROFILE_PUBLIC_COLS = ", ".join(WorkerProfilePublic.model_fields)
_ESTABLISHMENT_PUBLIC_COLS = ", ".join(
    f"workers:worker_establishment(...worker_profile!inner({_WORKER_PROFILE_PUBLIC_COLS}))"
    if name == "workers" else name
    for name in EstablishmentPublic.model_fields
)

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
            .select(_WORKER_PROFILE_PUBLIC_COLS)
            .eq("slug", slug)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except (APIError, httpx.HTTPError) as exc:
        logger.exception("worker_profile lookup failed for slug=%r", slug)
        raise DatabaseUnavailable(str(exc)) from exc

    if not resp.data:
        logger.info("Someone requested slug that does not exist %s for a worker", slug)
        return None

    try:
        row = to_public(WorkerProfilePublic, resp.data[0])

    except ValidationError as exc:
        logger.exception("worker_profile row failed validation for slug=%r", slug)
        raise DatabaseUnavailable("schema mismatch") from exc

    return row


def get_establishment_by_slug(slug: str) -> EstablishmentPublic | None:
    """
    Looks up one establishment's public profile by their slug.

    Args:
        - slug (str): unique slug from the booking URL

    Returns:
        - EstablishmentPublic row, or None if no establishment matches.

    Raises:
        - DatabaseUnavailable: the query itself failed (network, bad policy,
          schema drift). Distinct from "no such establishment", which is None.
    """
    try:
        resp = (
            public_db.table("establishment")
            .select(_ESTABLISHMENT_PUBLIC_COLS)
            .eq("slug", slug)
            .eq("is_active", True)
            .eq("worker_establishment.is_active", True)   # filters the embed
            .limit(1)
            .execute()
        )
    except (APIError, httpx.HTTPError) as exc:
        logger.exception("establishment lookup failed for slug=%r", slug)
        raise DatabaseUnavailable(str(exc)) from exc

    # make sure we got real data back
    if not resp.data:
        logger.info("Someone requested slug that does not exist %s for an establishment", slug)
        return None

    # format the data correctly
    try:
        row = to_public(EstablishmentPublic, resp.data[0])
    except ValidationError as exc:
        logger.exception("establishment row failed validation for slug=%r", slug)
        raise DatabaseUnavailable("schema mismatch") from exc

    return row