"""
Waitlist signups from the landing page: one insert and no reads. The table
holds contact details for people who are not users yet, so anon has no access
to it and the insert goes through admin_db, for the same reason as the
appointment insert -- the visitor writes a row they may not read back.
"""

import logging

import httpx
from postgrest import APIError, ReturnMethod

from server.models.public_models import JoinWaitlist
from server.supabase.booking import _NAME_CAP, _clean, _clean_email
from server.supabase.sb_function import DatabaseUnavailable, admin_db

logger = logging.getLogger(__name__)

_UNIQUE_VIOLATION = "23505"


class InvalidSignup(ValueError):
    """A name with nothing visible left once tidied, or an unusable email."""


def join_waitlist(signup: JoinWaitlist) -> None:
    """
    Adds one person to the waitlist. A repeat email returns normally without a
    second row, so the caller cannot tell who has already signed up.

    Args:
        - signup (JoinWaitlist): what the form posted

    Raises:
        - InvalidSignup: a blank name or an unusable email, checked before any query runs
        - DatabaseUnavailable: the insert failed for any reason but a repeat email
    """
    first_name = _clean(signup.first_name, _NAME_CAP)
    last_name = _clean(signup.last_name, _NAME_CAP)
    if not first_name or not last_name:
        raise InvalidSignup("First and last name are required")
    email = _clean_email(signup.email)
    if email is None:
        raise InvalidSignup("Enter a valid email address")

    row = {
        "first_name": first_name,
        "last_name": last_name,
        "phone": signup.phone,
        "email": email,
    }
    try:
        admin_db.table("waitlist_signup").insert(row, returning=ReturnMethod.minimal).execute()
    except APIError as exc:
        if exc.code == _UNIQUE_VIOLATION:
            logger.info("repeat waitlist signup")
            return
        logger.exception("waitlist insert failed")
        raise DatabaseUnavailable(str(exc)) from exc
    except httpx.HTTPError as exc:
        logger.exception("waitlist insert failed")
        raise DatabaseUnavailable(str(exc)) from exc
