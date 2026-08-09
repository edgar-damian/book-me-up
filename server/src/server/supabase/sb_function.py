"""
Supabase access layer.

Two clients, deliberately:

  public_db  - publishable key, RLS enforced. Every unauthenticated read goes
               through this. If a policy is missing the query returns nothing,
               which is the safe direction to fail.
  admin_db   - secret key, RLS *bypassed*. Superuser-equivalent. Reserve it for
               privileged server-side work (sweeping expired holds, admin
               tooling) and never reach for it just to make a query "work".

Both are built at import time so a bad config kills the process at startup
instead of every request.
"""
import logging

import httpx
from postgrest import APIError
from pydantic import ValidationError, create_model
from supabase import Client, ClientOptions, create_client

from server.core.config import settings
from server.models.supabase_models import WorkerProfile

logger = logging.getLogger(__name__)

# Supabase's default is 120s. A public endpoint that hangs that long is a
# denial-of-service surface; fail fast and let the caller retry.
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


# Columns on `worker_profile` that are safe to render publicly. user_id is
# excluded on purpose: it links to app_user, which holds PII (see CLAUDE.md).
# This tuple is the privacy boundary - widen it only with intent.
PUBLIC_WORKER_PROFILE_FIELDS = (
    "id", "slug", "first_name", "last_name", "bio", "image",
    "public_email", "public_phone", "hold_expiry_hours", "auto_accept",
    "min_lead_time_min", "max_advance_days", "cancellation_cutoff_min",
)

_SELECT_WORKER_PROFILE = ", ".join(PUBLIC_WORKER_PROFILE_FIELDS)

# Types come from the generated model, so they cannot drift from the table.
# A renamed or dropped column raises KeyError here - at import, not at request
# time - which is the cheap version of a schema-drift test.
WorkerProfileRow = create_model(
    "WorkerProfileRow",
    **{name: (WorkerProfile.model_fields[name].annotation,
              WorkerProfile.model_fields[name])
       for name in PUBLIC_WORKER_PROFILE_FIELDS},
)


def get_barber_by_slug(slug: str) -> dict | None:
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
        return None

    try:
        row = WorkerProfileRow.model_validate(resp.data[0])
    except ValidationError as exc:
        # The row does not match the generated schema - the table changed under
        # us. Refuse to serve it rather than pass unvalidated data outward.
        logger.exception("worker_profile row failed validation for slug=%r", slug)
        raise DatabaseUnavailable("schema mismatch") from exc

    return row.model_dump()
