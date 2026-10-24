"""
POST /auth/refresh through the real refresh with only Supabase faked: what is
traded, what comes back, and how every failure maps to a status.
"""

import logging
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from supabase import AuthApiError, AuthRetryableError

from server.supabase import auth

URL = "/auth/refresh"
SESSION = SimpleNamespace(
    access_token="access-2",
    refresh_token="refresh-2",
    expires_at=1_800_003_600,
    token_type="bearer",
)


@pytest.fixture
def supabase_refresh():
    """The Supabase refresh call. Returns SESSION unless a test changes it."""
    with patch.object(auth, "create_client") as factory:
        call = factory.return_value.auth.refresh_session
        call.return_value = SimpleNamespace(session=SESSION)
        yield call


def test_refresh_is_200_with_only_the_new_pair(client, supabase_refresh):
    response = client.post(URL, json={"refresh_token": "refresh-1"})

    assert response.status_code == 200
    assert response.json() == {
        "access_token": "access-2",
        "refresh_token": "refresh-2",
        "expires_at": 1_800_003_600,
    }
    supabase_refresh.assert_called_once_with("refresh-1")


@pytest.mark.parametrize("code", sorted(auth._SESSION_GONE))
def test_token_that_cannot_be_traded_is_401(client, supabase_refresh, code):
    supabase_refresh.side_effect = AuthApiError("Invalid Refresh Token", 400, code)

    assert client.post(URL, json={"refresh_token": "refresh-1"}).status_code == 401


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
        AuthRetryableError("Service Unavailable", 503),
        httpx.ConnectError("down"),
    ],
)
def test_outage_is_503(client, supabase_refresh, error):
    supabase_refresh.side_effect = error

    assert client.post(URL, json={"refresh_token": "refresh-1"}).status_code == 503


def test_empty_token_is_422_and_never_reaches_supabase(client, supabase_refresh):
    assert client.post(URL, json={"refresh_token": ""}).status_code == 422
    supabase_refresh.assert_not_called()


def test_logs_never_hold_the_refresh_token(client, supabase_refresh, caplog):
    caplog.set_level(logging.INFO)
    supabase_refresh.side_effect = AuthApiError(
        "Invalid Refresh Token", 400, "refresh_token_not_found"
    )

    client.post(URL, json={"refresh_token": "refresh-secret-1"})

    assert caplog.records
    assert "refresh-secret-1" not in caplog.text
