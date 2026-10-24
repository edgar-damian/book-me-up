"""
GET /auth/me through the real token check and get_me. The project's signing key
is one made here, and only the PostgREST client is faked.
"""

import json
import logging
import time
from types import SimpleNamespace
from unittest.mock import call, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from postgrest import APIError

from server.supabase import auth, sb_function

URL = "/auth/me"
USER_ID = "00000001-0000-4000-8000-000000000005"
ROW = {
    "first_name": "Ada",
    "last_name": "Lovelace",
    "email": "ada@example.com",
    "worker_profile": None,
    "establishment_owner": [],
}
PROJECT_KEY = ec.generate_private_key(ec.SECP256R1())


def make_token(signer=PROJECT_KEY, **claims):
    """An access token shaped like Supabase's. Keyword arguments override claims."""
    body = {
        "sub": USER_ID,
        "aud": "authenticated",
        "iss": auth._ISSUER,
        "exp": int(time.time()) + 3600,
        "role": "authenticated",
    }
    body.update(claims)
    body = {k: v for k, v in body.items() if v is not None}
    return jwt.encode(body, signer, algorithm="ES256", headers={"kid": "project-key"})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def signing_keys():
    """The JWKS lookup, answering with the project's public key."""
    public = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(PROJECT_KEY.public_key()))
    with patch.object(
        auth._JWKS, "get_signing_key_from_jwt", return_value=jwt.PyJWK(public | {"alg": "ES256"})
    ) as lookup:
        yield lookup


@pytest.fixture
def create_client():
    """The factory user_db calls. call_args holds the options."""
    with patch.object(sb_function, "create_client") as factory:
        yield factory


@pytest.fixture
def app_user(create_client):
    """The app_user query. Returns ROW unless a test changes it."""
    select = create_client.return_value.table.return_value.select.return_value
    query = select.eq.return_value.eq.return_value.limit.return_value
    query.execute.return_value = SimpleNamespace(data=[ROW])
    return SimpleNamespace(select=select, query=query)


def test_valid_token_returns_the_account(client, app_user):
    response = client.get(URL, headers=bearer(make_token()))

    assert response.status_code == 200
    assert response.json() == {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "email": "ada@example.com",
        "has_worker_profile": False,
        "has_shop": False,
    }


def test_query_runs_as_the_caller_and_reads_only_their_row(client, create_client, app_user):
    token = make_token()

    client.get(URL, headers=bearer(token))

    options = create_client.call_args.kwargs["options"]
    assert options.headers["Authorization"] == f"Bearer {token}"
    create_client.return_value.table.assert_called_once_with("app_user")
    assert app_user.select.eq.call_args == call("id", USER_ID)


@pytest.mark.parametrize(
    ("profile", "owned", "flags"),
    [
        ({"id": "p1", "worker_establishment": []}, [], (True, False)),
        ({"id": "p1", "worker_establishment": [{"id": "c1"}]}, [], (True, True)),
        (None, [{"id": "o1"}], (False, True)),
    ],
)
def test_flags_follow_profile_chairs_and_ownership(client, app_user, profile, owned, flags):
    row = {**ROW, "worker_profile": profile, "establishment_owner": owned}
    app_user.query.execute.return_value = SimpleNamespace(data=[row])

    body = client.get(URL, headers=bearer(make_token())).json()

    assert (body["has_worker_profile"], body["has_shop"]) == flags


def test_missing_header_is_401_and_asks_for_a_bearer_token(client, app_user):
    response = client.get(URL)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    app_user.query.execute.assert_not_called()


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        make_token(exp=int(time.time()) - 10),
        make_token(aud="anon"),
        make_token(iss="https://elsewhere.supabase.co/auth/v1"),
        make_token(sub=None),
        make_token(signer=ec.generate_private_key(ec.SECP256R1())),
    ],
    ids=["garbage", "expired", "audience", "issuer", "no-sub", "other-key"],
)
def test_bad_token_is_401_and_never_queries(client, app_user, token):
    assert client.get(URL, headers=bearer(token)).status_code == 401
    app_user.query.execute.assert_not_called()


def test_unknown_signing_key_is_401(client, signing_keys, app_user):
    signing_keys.side_effect = jwt.PyJWKClientError("Unable to find a signing key")

    assert client.get(URL, headers=bearer(make_token())).status_code == 401


def test_unreachable_signing_keys_are_503(client, signing_keys, app_user):
    signing_keys.side_effect = jwt.PyJWKClientConnectionError("down")

    assert client.get(URL, headers=bearer(make_token())).status_code == 503


def test_no_account_row_is_404(client, app_user):
    app_user.query.execute.return_value = SimpleNamespace(data=[])

    assert client.get(URL, headers=bearer(make_token())).status_code == 404


def test_token_postgrest_rejects_is_401(client, app_user):
    app_user.query.execute.side_effect = APIError({"code": "PGRST303", "message": "JWT expired"})

    assert client.get(URL, headers=bearer(make_token())).status_code == 401


@pytest.mark.parametrize(
    "outcome",
    [
        {"side_effect": APIError({"code": "42501", "message": "permission denied"})},
        {"return_value": SimpleNamespace(data=[{"first_name": "Ada"}])},
    ],
    ids=["query-failed", "schema-mismatch"],
)
def test_database_failure_is_503(client, app_user, outcome):
    app_user.query.execute.configure_mock(**outcome)

    assert client.get(URL, headers=bearer(make_token())).status_code == 503


def test_logs_never_hold_the_token(client, app_user, caplog):
    caplog.set_level(logging.INFO)
    expired = make_token(exp=int(time.time()) - 10)
    app_user.query.execute.side_effect = APIError({"code": "PGRST303", "message": "JWT expired"})

    client.get(URL, headers=bearer(expired))
    client.get(URL, headers=bearer(make_token()))

    assert caplog.records
    assert expired not in caplog.text
    assert expired.split(".")[1] not in caplog.text
