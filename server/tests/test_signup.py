"""
POST /auth/signup through the real make_new_user with only Supabase faked:
what reaches the sign-up call, and how every outcome maps to a status.
"""

import logging
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from supabase import AuthApiError, AuthRetryableError, AuthWeakPasswordError

from server.supabase import auth

URL = "/auth/signup"
SIGNUP = {
    "first_name": "  Ada ",
    "last_name": "Lovelace",
    "email": "Ada@Example.COM",
    "phone": "+15125550100",
    "password": "hunter2 ",
}
SESSION = SimpleNamespace(
    access_token="access",
    refresh_token="refresh",
    expires_at=1_800_000_000,
    token_type="bearer",
)


@pytest.fixture
def supabase_sign_up():
    """The Supabase sign-up call. Returns SESSION unless a test changes it."""
    with patch.object(auth, "create_client") as factory:
        call = factory.return_value.auth.sign_up
        call.return_value = SimpleNamespace(session=SESSION)
        yield call


def test_signup_is_201_with_only_the_three_token_fields(client, supabase_sign_up):
    response = client.post(URL, json=SIGNUP)

    assert response.status_code == 201
    assert response.json() == {
        "access_token": "access",
        "refresh_token": "refresh",
        "expires_at": 1_800_000_000,
    }


def test_trigger_gets_the_tidied_names_and_phone(client, supabase_sign_up):
    client.post(URL, json=SIGNUP)

    assert supabase_sign_up.call_args.args[0] == {
        "email": "ada@example.com",
        "password": "hunter2 ",
        "options": {
            "data": {"first_name": "Ada", "last_name": "Lovelace", "phone": "+15125550100"}
        },
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("phone", "5125550100"),
        ("phone", 15125550100),
        ("first_name", "   "),
        ("last_name", "​"),
        ("email", "nope"),
        ("password", ""),
    ],
)
def test_bad_input_is_422_and_never_reaches_supabase(client, supabase_sign_up, field, value):
    assert client.post(URL, json={**SIGNUP, field: value}).status_code == 422
    supabase_sign_up.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (AuthApiError("User already registered", 422, "user_already_exists"), 409),
        (AuthApiError("Email address already exists", 422, "email_exists"), 409),
        (AuthApiError("Email address is invalid", 400, "email_address_invalid"), 422),
        (AuthApiError("Signups not allowed for this instance", 422, "signup_disabled"), 403),
    ],
)
def test_supabase_refusal_maps_to_its_status(client, supabase_sign_up, error, status):
    supabase_sign_up.side_effect = error

    assert client.post(URL, json=SIGNUP).status_code == status


def test_weak_password_is_422_with_the_rule_it_broke(client, supabase_sign_up):
    supabase_sign_up.side_effect = AuthWeakPasswordError(
        "Password should be at least 6 characters.", 422, ["length"]
    )

    response = client.post(URL, json=SIGNUP)

    assert response.status_code == 422
    assert response.json()["detail"] == "Password should be at least 6 characters."


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
        AuthApiError("Database error saving new user", 500, "unexpected_failure"),
        AuthRetryableError("Service Unavailable", 503),
        httpx.ConnectError("down"),
    ],
)
def test_outage_is_503(client, supabase_sign_up, error):
    supabase_sign_up.side_effect = error

    assert client.post(URL, json=SIGNUP).status_code == 503


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("User already registered", 422, "user_already_exists"),
        httpx.ConnectError("down"),
    ],
)
def test_logs_hold_neither_email_nor_password(client, supabase_sign_up, caplog, error):
    caplog.set_level(logging.INFO)
    supabase_sign_up.side_effect = error

    client.post(URL, json=SIGNUP)

    assert caplog.records
    assert "ada@example.com" not in caplog.text.lower()
    assert "hunter2" not in caplog.text
