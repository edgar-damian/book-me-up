"""
Bodies and responses for worker auth. Passwords and refresh tokens are
SecretStr, so they print as " ********** " if a model is ever logged.
"""

from pydantic import BaseModel, Field, SecretStr


class LogIn(BaseModel):
    """What the login form posts. sign_in tidies the email; the password is sent as typed."""

    email: str
    password: SecretStr = Field(min_length=1)


class LoggedIn(BaseModel):
    """A Supabase session trimmed to what the client stores. expires_at is unix seconds."""

    access_token: str
    refresh_token: str
    expires_at: int


class NewAppUser(BaseModel):
    """
    What the sign-up form posts. make_new_user tidies the names and email; the
    password is sent as typed. The phone is checked here because the trigger that
    writes app_user rejects anything but E.164, and that would abort the sign-up.
    """

    first_name: str
    last_name: str
    email: str
    phone: str = Field(description="E.164", pattern=r"^\+[1-9][0-9]{1,14}$")
    password: SecretStr = Field(min_length=1)


class RefreshSession(BaseModel):
    """What the client posts to trade its refresh token for a new session."""

    refresh_token: SecretStr = Field(min_length=1)


class Me(BaseModel):
    """
    The signed-in user's own account, for the dashboard. has_shop is true for an
    owner of any shop or a worker with an active chair.
    """

    first_name: str
    last_name: str
    email: str | None
    has_worker_profile: bool
    has_shop: bool
