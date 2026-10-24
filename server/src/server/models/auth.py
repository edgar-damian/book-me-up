"""
Bodies for worker login. The password is a SecretStr, so it prints as
" ********** " if the model is ever logged.
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
    """New users who are filling out the SingUp Page """
    first_name: str
    last_name: str
    email: str
    phone: int
    password: SecretStr