"""
sign_in with only Supabase faked: what reaches the sign-in call, what comes
back, and how every failure maps to InvalidCredentials or DatabaseUnavailable.
"""

import logging
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from supabase import AuthApiError, AuthRetryableError

from server.models.auth import LogIn
from server.supabase import auth
from server.supabase.auth import InvalidCredentials
from server.supabase.sb_function import DatabaseUnavailable

CREDENTIALS = LogIn(email="  Ana@Example.COM ", password="hunter2 ")
SESSION = SimpleNamespace(
    access_token="access",
    refresh_token="refresh",
    expires_at=1_800_000_000,
    token_type="bearer",
    user=SimpleNamespace(id="u1", email="ana@example.com"),
)


@pytest.fixture
def create_client():
    """The per-call client factory. call_args holds the options."""
    with patch.object(auth, "create_client") as factory:
        yield factory


@pytest.fixture
def supabase_sign_in(create_client):
    """The Supabase sign-in call. Returns SESSION unless a test changes it."""
    call = create_client.return_value.auth.sign_in_with_password
    call.return_value = SimpleNamespace(session=SESSION)
    return call


def test_returns_only_the_three_token_fields(supabase_sign_in):
    session = auth.sign_in(CREDENTIALS)

    assert session.model_dump() == {
        "access_token": "access",
        "refresh_token": "refresh",
        "expires_at": 1_800_000_000,
    }


def test_email_is_tidied_and_password_is_sent_as_typed(supabase_sign_in):
    auth.sign_in(CREDENTIALS)

    assert supabase_sign_in.call_args.args[0] == {
        "email": "ana@example.com",
        "password": "hunter2 ",
    }


def test_client_keeps_no_session_and_never_refreshes(create_client, supabase_sign_in):
    auth.sign_in(CREDENTIALS)

    options = create_client.call_args.kwargs["options"]
    assert options.auto_refresh_token is False
    assert options.persist_session is False


def test_unusable_email_never_reaches_supabase(create_client):
    with pytest.raises(InvalidCredentials):
        auth.sign_in(LogIn(email="nope", password="hunter2"))

    create_client.assert_not_called()


@pytest.mark.parametrize("code", sorted(auth._REJECTED))
def test_refused_login_is_invalid_credentials(supabase_sign_in, code):
    supabase_sign_in.side_effect = AuthApiError("refused", 400, code)

    with pytest.raises(InvalidCredentials):
        auth.sign_in(CREDENTIALS)


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
        AuthApiError("Invalid API key", 401, None),
        AuthRetryableError("Service Unavailable", 503),
        httpx.ConnectError("down"),
    ],
)
def test_outage_is_database_unavailable(supabase_sign_in, error):
    supabase_sign_in.side_effect = error

    with pytest.raises(DatabaseUnavailable):
        auth.sign_in(CREDENTIALS)


def test_missing_session_is_database_unavailable(supabase_sign_in):
    supabase_sign_in.return_value = SimpleNamespace(session=None)

    with pytest.raises(DatabaseUnavailable):
        auth.sign_in(CREDENTIALS)


@pytest.mark.parametrize(
    "error",
    [AuthApiError("refused", 400, "invalid_credentials"), httpx.ConnectError("down")],
)
def test_logs_hold_neither_email_nor_password(supabase_sign_in, caplog, error):
    caplog.set_level(logging.INFO)
    supabase_sign_in.side_effect = error

    with pytest.raises((InvalidCredentials, DatabaseUnavailable)):
        auth.sign_in(CREDENTIALS)

    assert caplog.records
    assert "ana@example.com" not in caplog.text.lower()
    assert "hunter2" not in caplog.text
