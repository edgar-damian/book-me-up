"""
POST /waitlist through the real join_waitlist with only the database faked:
what reaches the insert, and how every outcome maps to a status.
"""

from unittest.mock import patch

import httpx
import pytest
from postgrest import APIError

from server.supabase import waitlist

URL = "/waitlist"
SIGNUP = {
    "first_name": "  Ada ",
    "last_name": "Lovelace",
    "phone": "+15125550100",
    "email": "Ada@Example.COM",
}


@pytest.fixture
def insert():
    """The admin_db insert. call_args holds the row."""
    with patch.object(waitlist, "admin_db") as admin_db:
        yield admin_db.table.return_value.insert


def test_signup_is_204_and_stores_the_tidied_row(client, insert):
    assert client.post(URL, json=SIGNUP).status_code == 204
    assert insert.call_args.args[0] == {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "phone": "+15125550100",
        "email": "ada@example.com",
    }


def test_offer_and_timestamp_cannot_be_posted(client, insert):
    body = {**SIGNUP, "received_offer": True, "submitted_at": "2020-01-01T00:00:00Z"}
    assert client.post(URL, json=body).status_code == 204
    assert set(insert.call_args.args[0]) == {"first_name", "last_name", "phone", "email"}


def test_repeat_email_is_still_204(client, insert):
    insert.return_value.execute.side_effect = APIError({"code": "23505", "message": "duplicate"})
    assert client.post(URL, json=SIGNUP).status_code == 204


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("first_name", "   "),
        ("last_name", "​"),
        ("email", "not-an-email"),
        ("phone", "555-0100"),
    ],
)
def test_bad_input_is_422_and_nothing_is_written(client, insert, field, value):
    assert client.post(URL, json={**SIGNUP, field: value}).status_code == 422
    insert.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [APIError({"code": "42501", "message": "permission denied"}), httpx.ConnectError("down")],
)
def test_database_failure_is_503(client, insert, error):
    insert.return_value.execute.side_effect = error
    assert client.post(URL, json=SIGNUP).status_code == 503
