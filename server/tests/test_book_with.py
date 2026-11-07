from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

from server.supabase import sb_function
from server.supabase.sb_function import DatabaseUnavailable

TARGET = "server.routes.apis.get_worker_by_slug"


def test_404_when_no_such_barber(client):
    with patch(TARGET, return_value=None):
        r = client.get("/workers/ricky-cuts")
    assert r.status_code == 404


def test_503_when_db_unavailable(client):
    with patch(TARGET, side_effect=DatabaseUnavailable("boom")):
        r = client.get("/workers/ricky-cuts")
    assert r.status_code == 503
    # The 503 detail is deliberately vague; internals go to logs only.
    assert "boom" not in r.text


@pytest.mark.parametrize("bad", ["Ricky-Cuts", "ricky_cuts", "-ricky", "a" * 65])
def test_422_on_malformed_slug(client, bad):
    r = client.get(f"/workers/{bad}")
    assert r.status_code == 422


@pytest.fixture
def worker_page(worker_row):
    """The real get_worker_by_slug, with PostgREST answering worker_row."""
    with patch.object(sb_function, "public_db") as public_db:
        select = public_db.table.return_value.select
        live = select.return_value.eq.return_value.eq
        offered = live.return_value.eq
        chairs = offered.return_value.eq
        chairs.return_value.limit.return_value.execute.return_value = MagicMock(data=[worker_row])
        yield SimpleNamespace(select=select, offered=offered, row=worker_row)


def test_worker_page_only_asks_for_services_still_offered(client, worker_page):
    assert client.get("/workers/ricky-cuts").status_code == 200
    assert worker_page.offered.call_args == call("service.is_active", True)


def test_worker_page_shows_a_services_saved_details(client, worker_page):
    saved = {
        "title": "Zero fade",
        "description": "Down to the skin.",
        "price_cents": 9900,
        "duration_min": 90,
    }
    worker_page.row["services"][0] |= saved

    services = client.get("/workers/ricky-cuts").json()["services"]

    assert len(services) == 1
    assert {k: services[0][k] for k in saved} == saved


def test_worker_page_never_shows_the_buffer(client, worker_page):
    worker_page.row["services"][0]["buffer_after_min"] = 15

    service = client.get("/workers/ricky-cuts").json()["services"][0]

    assert "buffer_after_min" not in service
    assert "buffer_after_min" not in worker_page.select.call_args.args[0]
