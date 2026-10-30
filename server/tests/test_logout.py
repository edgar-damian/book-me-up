"""
POST /auth/logout through the real sign_out with only Supabase faked. current_user
is overridden with a fixed caller, since tests/test_me.py already covers the token
check.
"""

import logging
from unittest.mock import patch

import httpx
import pytest
from supabase import AuthApiError, AuthRetryableError

from server.main import app
from server.routes.auth import current_user
from server.supabase import auth
from server.supabase.auth import Caller

URL = "/auth/logout"
CALLER = Caller(user_id="00000001-0000-4000-8000-000000000005", access_token="access-1")


@pytest.fixture(autouse=True)
def signed_in():
    """Every request runs as CALLER unless a test removes the override."""
    app.dependency_overrides[current_user] = lambda: CALLER
    yield
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture
def supabase_sign_out():
    """The Supabase sign-out call. Succeeds unless a test changes it."""
    with patch.object(auth, "create_client") as factory:
        yield factory.return_value.auth.admin.sign_out


def test_logout_is_204_and_ends_only_this_session(client, supabase_sign_out):
    response = client.post(URL)

    assert response.status_code == 204
    assert response.content == b""
    supabase_sign_out.assert_called_once_with("access-1", scope="local")


@pytest.mark.parametrize("code", sorted(auth._SESSION_GONE))
def test_session_already_over_is_still_204(client, supabase_sign_out, code):
    supabase_sign_out.side_effect = AuthApiError("Session not found", 403, code)

    assert client.post(URL).status_code == 204


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
        AuthApiError("Invalid API key", 401, None),
        AuthRetryableError("Service Unavailable", 503),
        httpx.ConnectError("down"),
    ],
)
def test_outage_is_503(client, supabase_sign_out, error):
    supabase_sign_out.side_effect = error

    assert client.post(URL).status_code == 503


def test_missing_token_is_401_and_never_reaches_supabase(client, supabase_sign_out):
    app.dependency_overrides.pop(current_user)

    assert client.post(URL).status_code == 401
    supabase_sign_out.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Session not found", 403, "session_not_found"),
        AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
    ],
)
def test_logs_never_hold_the_access_token(client, supabase_sign_out, caplog, error):
    caplog.set_level(logging.INFO)
    supabase_sign_out.side_effect = error

    client.post(URL)

    assert caplog.records
    assert "access-1" not in caplog.text
