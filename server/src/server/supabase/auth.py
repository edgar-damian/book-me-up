"""
Sign-in through Supabase Auth. Each call builds its own client because
supabase-py switches a client's Authorization header to whoever signs in on it;
on the shared public_db, every later public read would run as that user.
Auto-refresh is off because the refresh token belongs to the caller, and a
background refresh here would spend it.
"""

import logging

import httpx
from pydantic import ValidationError
from supabase import AuthApiError, AuthError, ClientOptions, create_client

from server.core.config import settings
from server.models.auth import LoggedIn, LogIn, NewAppUser
from server.supabase.booking import _clean_email
from server.supabase.sb_function import _TIMEOUT, DatabaseUnavailable

logger = logging.getLogger(__name__)

# Codes that mean these credentials can't sign in. Anything else, like a bad API key or a
# 429, is an outage: every sign-in comes from this server's IP, so a 429 locks out everyone.
_REJECTED = frozenset(
    {"invalid_credentials", "email_not_confirmed", "user_banned", "validation_failed"}
)


class InvalidCredentials(ValueError):
    """Supabase refused the email and password. Route turns this into a 401."""


def sign_in(credentials: LogIn) -> LoggedIn:
    """
    Trades an email and password for a Supabase session.

    Args:
        - credentials (LogIn): what the login form posted

    Returns:
        - LoggedIn: the access token, refresh token, and expiry, nothing else

    Raises:
        - InvalidCredentials: an unusable email, checked before any request, or a refused login
        - DatabaseUnavailable: Supabase was unreachable, rate limited, or answered unexpectedly
    """
    email = _clean_email(credentials.email)
    if email is None:
        raise InvalidCredentials("unusable email")

    try:
        with httpx.Client(timeout=_TIMEOUT) as http:
            client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_PUBLISHABLE_KEY.get_secret_value(),
                options=ClientOptions(
                    httpx_client=http, persist_session=False, auto_refresh_token=False
                ),
            )
            response = client.auth.sign_in_with_password(
                {"email": email, "password": credentials.password.get_secret_value()}
            )
    except AuthApiError as exc:
        if exc.code in _REJECTED:
            logger.info("sign in rejected: %s", exc.code)
            raise InvalidCredentials(str(exc)) from exc
        logger.exception("sign in failed")
        raise DatabaseUnavailable(str(exc)) from exc
    except (AuthError, httpx.HTTPError) as exc:
        logger.exception("sign in failed")
        raise DatabaseUnavailable(str(exc)) from exc

    try:
        return LoggedIn.model_validate(response.session, from_attributes=True)
    except ValidationError as exc:
        logger.exception("sign in returned an unusable session")
        raise DatabaseUnavailable("schema mismatch") from exc


def make_new_user(user: NewAppUser) -> LoggedIn:
    """
    Trades an email and password for a Supabase session.

    Args:
        - credentials (LogIn): what the login form posted

    Returns:
        - LoggedIn: the access token, refresh token, and expiry, nothing else

    Raises:
        - InvalidCredentials: an unusable email, checked before any request, or a refused login
        - DatabaseUnavailable: Supabase was unreachable, rate limited, or answered unexpectedly
    """
    email = _clean_email(NewAppUser.email)
    if email is None:
        raise InvalidCredentials("unusable email")

    try:
        with httpx.Client(timeout=_TIMEOUT) as http:
            client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_PUBLISHABLE_KEY.get_secret_value(),
                options=ClientOptions(
                    httpx_client=http, persist_session=False, auto_refresh_token=False
                ),
            )
            response = client.auth.sign_in_with_password(
                {"email": email, "password": credentials.password.get_secret_value()}
            )
    except AuthApiError as exc:
        if exc.code in _REJECTED:
            logger.info("sign in rejected: %s", exc.code)
            raise InvalidCredentials(str(exc)) from exc
        logger.exception("sign in failed")
        raise DatabaseUnavailable(str(exc)) from exc
    except (AuthError, httpx.HTTPError) as exc:
        logger.exception("sign in failed")
        raise DatabaseUnavailable(str(exc)) from exc

    try:
        return LoggedIn.model_validate(response.session, from_attributes=True)
    except ValidationError as exc:
        logger.exception("sign in returned an unusable session")
        raise DatabaseUnavailable("schema mismatch") from exc