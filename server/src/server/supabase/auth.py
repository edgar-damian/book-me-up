"""
Sign-in and sign-up through Supabase Auth. Each call builds its own client because
supabase-py switches a client's Authorization header to whoever signs in on it;
on the shared public_db, every later public read would run as that user.
Auto-refresh is off because the refresh token belongs to the caller, and a
background refresh here would spend it.

Access tokens are checked here too, against the project's published signing keys,
before any query runs as that user.
"""

import logging
from dataclasses import dataclass

import httpx
import jwt
from pydantic import BaseModel, ValidationError
from supabase import (
    AuthApiError,
    AuthError,
    AuthWeakPasswordError,
    ClientOptions,
    create_client,
)

from server.core.config import settings
from server.models.auth import LoggedIn, LogIn, Me, NewAppUser, RefreshSession
from server.supabase.booking import _NAME_CAP, _clean, _clean_email
from server.supabase.sb_function import (
    _TIMEOUT,
    DatabaseUnavailable,
    NotSignedIn,
    _cols,
    _run_as_user,
    user_db,
)

logger = logging.getLogger(__name__)

# Codes that mean these credentials can't sign in. Anything else, like a bad API key or a
# 429, is an outage: every sign-in comes from this server's IP, so a 429 locks out everyone.
_REJECTED = frozenset(
    {"invalid_credentials", "email_not_confirmed", "user_banned", "validation_failed"}
)


_EMAIL_TAKEN = frozenset({"user_already_exists", "email_exists"})

# A refresh token that can never be traded again. The user has to log in.
_SESSION_GONE = frozenset(
    {
        "refresh_token_not_found",
        "refresh_token_already_used",
        "session_expired",
        "session_not_found",
    }
)

# No request at import. The keys are fetched on the first check and cached, so a
# normal check is local; an unknown kid refetches, at most once per cooldown.
_JWKS = jwt.PyJWKClient(settings.SUPABASE_JWKS_URL, cache_keys=True, lifespan=600, timeout=10)
_ISSUER = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"


class InvalidCredentials(ValueError):
    """Supabase refused the email and password. Route turns this into a 401."""


class InvalidNewUser(ValueError):
    """A blank name, an unusable email, or a weak password. Route turns this into a 422."""


class EmailTaken(ValueError):
    """An account already uses this email. Route turns this into a 409."""


class SignUpClosed(RuntimeError):
    """Sign-ups are switched off in Supabase Auth. Route turns this into a 403."""


@dataclass(frozen=True)
class Caller:
    """A checked access token and the user it belongs to."""

    user_id: str
    access_token: str


class _MeRow(BaseModel):
    """The caller's app_user row, with just enough of two embeds to derive Me's flags."""

    class Profile(BaseModel):
        class Chair(BaseModel):
            id: str

        id: str
        is_active: bool
        worker_establishment: list[Chair]

    class Ownership(BaseModel):
        id: str

    first_name: str
    last_name: str
    email: str | None
    worker_profile: Profile | None
    establishment_owner: list[Ownership]


_ME_COLS = _cols(
    _MeRow,
    worker_profile=(
        "worker_profile("
        + _cols(
            _MeRow.Profile,
            worker_establishment=f"worker_establishment({_cols(_MeRow.Profile.Chair)})",
        )
        + ")"
    ),
    establishment_owner=f"establishment_owner({_cols(_MeRow.Ownership)})",
)


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
    Creates a Supabase Auth user and returns its first session. Nothing here
    inserts into app_user: the on_auth_user_created trigger writes that row from
    options.data, which is why the names and phone travel there.

    Args:
        - user (NewAppUser): what the sign-up form posted

    Returns:
        - LoggedIn: the access token, refresh token, and expiry, nothing else

    Raises:
        - InvalidNewUser: a blank name or unusable email, checked before any request,
          or a password Supabase calls weak
        - EmailTaken: an account already uses this email
        - SignUpClosed: sign-ups are switched off in Supabase Auth
        - DatabaseUnavailable: Supabase was unreachable, rate limited, or answered unexpectedly
    """
    first_name = _clean(user.first_name, _NAME_CAP)
    last_name = _clean(user.last_name, _NAME_CAP)
    if not first_name or not last_name:
        raise InvalidNewUser("First and last name are required")
    email = _clean_email(user.email)
    if email is None:
        raise InvalidNewUser("Enter a valid email address")

    try:
        with httpx.Client(timeout=_TIMEOUT) as http:
            client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_PUBLISHABLE_KEY.get_secret_value(),
                options=ClientOptions(
                    httpx_client=http, persist_session=False, auto_refresh_token=False
                ),
            )
            response = client.auth.sign_up(
                {
                    "email": email,
                    "password": user.password.get_secret_value(),
                    "options": {
                        "data": {
                            "first_name": first_name,
                            "last_name": last_name,
                            "phone": user.phone,
                        }
                    },
                }
            )
    # Not an AuthApiError, so it needs its own clause. Its message names the
    # rule the password broke and is safe to show.
    except AuthWeakPasswordError as exc:
        logger.info("sign up rejected: %s", exc.code)
        raise InvalidNewUser(exc.message) from exc
    except AuthApiError as exc:
        if exc.code in _EMAIL_TAKEN:
            logger.info("sign up rejected: %s", exc.code)
            raise EmailTaken(str(exc)) from exc
        if exc.code == "email_address_invalid":
            logger.info("sign up rejected: %s", exc.code)
            raise InvalidNewUser("Enter a valid email address") from exc
        if exc.code == "signup_disabled":
            logger.info("sign up rejected: %s", exc.code)
            raise SignUpClosed(str(exc)) from exc
        logger.exception("sign up failed")
        raise DatabaseUnavailable(str(exc)) from exc
    except (AuthError, httpx.HTTPError) as exc:
        logger.exception("sign up failed")
        raise DatabaseUnavailable(str(exc)) from exc

    try:
        return LoggedIn.model_validate(response.session, from_attributes=True)
    except ValidationError as exc:
        logger.exception("sign up returned an unusable session")
        raise DatabaseUnavailable("schema mismatch") from exc


def verify_token(token: str) -> Caller:
    """
    Checks an access token's signature, expiry, audience, and issuer against the
    project's published signing keys. Only the error class is logged, never the token.

    Args:
        - token (str): the bearer token from the request

    Returns:
        - Caller: the user id from the token's sub claim, with the token itself

    Raises:
        - NotSignedIn: the token is malformed, expired, or not signed by this project
        - DatabaseUnavailable: the signing keys could not be fetched
    """
    try:
        key = _JWKS.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=[key.algorithm_name],
            audience="authenticated",
            issuer=_ISSUER,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWKClientConnectionError as exc:
        logger.exception("signing keys unreachable")
        raise DatabaseUnavailable(str(exc)) from exc
    except jwt.PyJWTError as exc:
        logger.info("jwt rejected: %s", type(exc).__name__)
        raise NotSignedIn(type(exc).__name__) from exc

    return Caller(user_id=claims["sub"], access_token=token)


def refresh(body: RefreshSession) -> LoggedIn:
    """
    Trades a refresh token for a new session. Supabase refresh tokens are single
    use, so the caller must store the new pair and drop the old one.

    Args:
        - body (RefreshSession): the refresh token the client holds

    Returns:
        - LoggedIn: the new access token, refresh token, and expiry

    Raises:
        - NotSignedIn: the refresh token is unknown, already spent, or its session ended
        - DatabaseUnavailable: Supabase was unreachable, rate limited, or answered unexpectedly
    """
    try:
        with httpx.Client(timeout=_TIMEOUT) as http:
            client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_PUBLISHABLE_KEY.get_secret_value(),
                options=ClientOptions(
                    httpx_client=http, persist_session=False, auto_refresh_token=False
                ),
            )
            response = client.auth.refresh_session(body.refresh_token.get_secret_value())
    except AuthApiError as exc:
        if exc.code in _SESSION_GONE:
            logger.info("refresh rejected: %s", exc.code)
            raise NotSignedIn(exc.code) from exc
        logger.exception("refresh failed")
        raise DatabaseUnavailable(str(exc)) from exc
    except (AuthError, httpx.HTTPError) as exc:
        logger.exception("refresh failed")
        raise DatabaseUnavailable(str(exc)) from exc

    try:
        return LoggedIn.model_validate(response.session, from_attributes=True)
    except ValidationError as exc:
        logger.exception("refresh returned an unusable session")
        raise DatabaseUnavailable("schema mismatch") from exc


def get_me(caller: Caller) -> Me | None:
    """
    The caller's own account and setup status, read as the caller so RLS applies.

    Args:
        - caller (Caller): from verify_token

    Returns:
        - Me, or None when the user has no app_user row

    Raises:
        - NotSignedIn: PostgREST rejected the token, e.g. it expired after verify_token
        - DatabaseUnavailable: the query failed, or the row didn't match _MeRow
    """
    with user_db(caller.access_token) as db:
        resp = _run_as_user(
            db.table("app_user")
            .select(_ME_COLS)
            .eq("id", caller.user_id)
            .eq("worker_profile.worker_establishment.is_active", True)
            .limit(1),
            "app_user",
        )

    if not resp.data:
        return None
    try:
        row = _MeRow.model_validate(resp.data[0])
    except ValidationError as exc:
        logger.exception("app_user row failed validation")
        raise DatabaseUnavailable("schema mismatch") from exc

    profile = row.worker_profile
    return Me(
        first_name=row.first_name,
        last_name=row.last_name,
        email=row.email,
        has_worker_profile=profile is not None,
        has_shop=bool(row.establishment_owner) or bool(profile and profile.worker_establishment),
        is_live=bool(profile and profile.is_active),
    )
