from unittest.mock import patch

import pytest

from server.supabase.sb_function import DatabaseUnavailable

TARGET = "server.routes.apis.get_worker_by_slug"


def test_404_when_no_such_barber(client):
    with patch(TARGET, return_value=None):
        r = client.get("/book-with/ricky-cuts")
    assert r.status_code == 404


def test_503_when_db_unavailable(client):
    with patch(TARGET, side_effect=DatabaseUnavailable("boom")):
        r = client.get("/book-with/ricky-cuts")
    assert r.status_code == 503
    # The 503 detail is deliberately vague; internals go to logs only.
    assert "boom" not in r.text


@pytest.mark.parametrize("bad", ["Ricky-Cuts", "ricky_cuts", "-ricky", "a" * 65])
def test_422_on_malformed_slug(client, bad):
    r = client.get(f"/book-with/{bad}")
    assert r.status_code == 422
