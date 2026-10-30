"""
Worker authentication. Supabase Auth owns the credentials; these routes exchange
them for a session, renew it, end it, and check it on requests that act as the user.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from server.models.auth import LoggedIn, LogIn, Me, NewAppUser, RefreshSession
from server.supabase.auth import (
    Caller,
    EmailTaken,
    InvalidCredentials,
    InvalidNewUser,
    SignUpClosed,
    get_me,
    make_new_user,
    refresh,
    sign_in,
    sign_out,
    verify_token,
)
from server.supabase.sb_function import DatabaseUnavailable, NotSignedIn

router = APIRouter(prefix="/auth", tags=["auth"])

# auto_error=False so a missing header reaches current_user, which answers 401
# with the same body as a bad token.
_bearer = HTTPBearer(auto_error=False)


def _not_signed_in() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not signed in",
        headers={"WWW-Authenticate": "Bearer"},
    )


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Caller:
    """
    The checked caller, for any route that acts as the signed-in user:
    `caller: Annotated[Caller, Depends(current_user)]`.
    """
    if credentials is None:
        raise _not_signed_in()
    try:
        return verify_token(credentials.credentials)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.post(
    "/login",
    response_model=LoggedIn,
    responses={401: {"description": "Wrong email or password"}},
)
def login(credentials: LogIn):
    """
    Trades an email and password for a Supabase session. The access token
    authenticates later requests and the refresh token renews it once it expires.
    """
    try:
        session = sign_in(credentials)
    except InvalidCredentials:
        # One message for both cases, so the form can't reveal which emails have accounts.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    return session


@router.post(
    "/signup",
    response_model=LoggedIn,
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"description": "Sign-ups are switched off"},
        409: {"description": "An account already uses this email"},
        422: {"description": "A blank name, an unusable email or phone, or a weak password"},
    },
)
def signup(user: NewAppUser):
    """
    Creates an account and returns its first session, the same tokens /auth/login
    hands back.
    """
    try:
        session = make_new_user(user)
    except InvalidNewUser as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except EmailTaken:
        # Unlike login, this tells the caller the email has an account.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already uses this email",
        )
    except SignUpClosed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sign-ups are closed",
        )
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    return session


@router.post(
    "/refresh",
    response_model=LoggedIn,
    responses={401: {"description": "The refresh token can't be used again"}},
)
def refresh_session(body: RefreshSession):
    """
    Trades a refresh token for a new session. The old refresh token stops working,
    so the caller must keep the new one.
    """
    try:
        return refresh(body)
    except NotSignedIn:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Log in again",
        )
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"description": "Missing, invalid, or expired access token"}},
)
def logout(caller: Annotated[Caller, Depends(current_user)]):
    """
    Ends the session the access token belongs to, so its refresh token stops
    working. Other devices stay signed in, and the access token works until it
    expires.
    """
    try:
        sign_out(caller)
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get(
    "/me",
    response_model=Me,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "No account row for this user"},
    },
)
def me(caller: Annotated[Caller, Depends(current_user)]):
    """The signed-in user's own account and setup status, for the dashboard."""
    try:
        account = get_me(caller)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account
