"""
Worker authentication. Supabase Auth owns the credentials; these routes only
exchange them for a session and hand it back.
"""

from fastapi import APIRouter, HTTPException, status

from server.models.auth import LoggedIn, LogIn
from server.supabase.auth import InvalidCredentials, sign_in
from server.supabase.sb_function import DatabaseUnavailable

router = APIRouter(prefix="/auth", tags=["auth"])


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
    responses={401: {"description": "Wrong email or password"}},
)
def signup(credentials: LogIn):
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