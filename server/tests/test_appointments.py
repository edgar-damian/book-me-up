"""
POST /booking/appointments end to end, through the real make_appointment with
only the database faked. This is what shows the free text reaches the insert
as typed, and that the route still maps every outcome to the right status.
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from server.models.booking import AppointmentBooked
from server.supabase import booking
from server.supabase.booking import SlotTaken, _Context, _ScheduleDay
from server.supabase.sb_function import DatabaseUnavailable

URL = "/booking/appointments"
PHONE = "+15555550123"


def _open_chair(_establishment_id, _worker_id, _service_id, now_utc: datetime) -> _Context:
    """Stands in for _load_context: a chair open all day, every day, in UTC."""
    today = now_utc.date()
    return _Context(
        chair_id=uuid4(),
        tz="UTC",
        zone=ZoneInfo("UTC"),
        by_dow={d: _ScheduleDay(day_of_week=d, start_minute=0, end_minute=1440) for d in range(7)},
        service_title="Skin fade",
        worker_name="Ricky Reyes",
        worker_slug="ricky-cuts",
        establishment_name="Downtown Cuts",
        price_cents=3500,
        duration_min=45,
        buffer_after_min=15,
        slot_min=60,
        auto_accept=True,
        hold_expiry_hours=24,
        lead_instant=now_utc,
        window_start=today,
        window_end=today + timedelta(days=30),
    )


def _saved(row: dict) -> MagicMock:
    """PostgREST's answer to the insert, with ends_at filled in the way the trigger does."""
    ends_at = datetime.fromisoformat(row["starts_at"]) + timedelta(minutes=row["duration_min"])
    saved = {
        "id": str(uuid4()),
        "status": row["status"],
        "starts_at": row["starts_at"],
        "ends_at": ends_at.isoformat(),
        "hold_expires_at": row["hold_expires_at"],
    }
    return MagicMock(execute=MagicMock(return_value=MagicMock(data=[saved])))


@pytest.fixture
def insert():
    """The admin_db insert, with the reads it depends on faked. call_args holds the row."""
    with (
        patch.object(booking, "_load_context", side_effect=_open_chair),
        patch.object(booking, "_fetch_busy", return_value=[]),
        patch.object(booking, "admin_db") as admin_db,
    ):
        admin_db.table.return_value.insert.side_effect = _saved
        yield admin_db.table.return_value.insert


def _slot(minute: int = 0) -> str:
    """Tomorrow at 10:00 UTC, which is on the 15 minute grid unless minute moves it off."""
    day = datetime.now(UTC).date() + timedelta(days=1)
    return datetime(day.year, day.month, day.day, 10, minute, tzinfo=UTC).isoformat()


def _body(first="Pearl", last="Krabs", phone=PHONE, email=None, notes=None, starts_at=None):
    return {
        "client": {"first_name": first, "last_name": last, "phone": phone, "email": email},
        "starts_at": starts_at or _slot(),
        "notes": notes,
        "service_id": str(uuid4()),
        "worker_id": str(uuid4()),
        "establishment_id": str(uuid4()),
    }


def _row(insert) -> dict:
    insert.assert_called_once()
    return insert.call_args.args[0]


@pytest.mark.parametrize(
    "first,last,notes",
    [
        ("Pearl", "O'Brien", "my sons' and my cuts back to back"),
        ("José", "García", '"skin fade" or "low taper", budget is $40; thanks <3'),
        ("Ng'ang'a", "D'Arcy-O'Neill", "'; DROP TABLE appointment;--"),
    ],
)
def test_details_reach_the_insert_as_typed(client, insert, first, last, notes):
    body = _body(first=first, last=last, email="O'Brien@Example.com", notes=notes)
    assert client.post(URL, json=body).status_code == 201
    row = _row(insert)
    assert row["client_name"] == f"{first} {last}"
    assert row["client_notes"] == notes
    assert row["client_email"] == "o'brien@example.com"
    assert row["client_phone"] == PHONE


def test_text_is_tidied_on_the_way_in(client, insert):
    body = _body(first="  Pearl ", last=" Krabs  ", notes="Fade on the sides\r\nScissors on top")
    assert client.post(URL, json=body).status_code == 201
    row = _row(insert)
    assert row["client_name"] == "Pearl Krabs"
    assert row["client_notes"] == "Fade on the sides Scissors on top"


def test_notes_are_capped(client, insert):
    assert client.post(URL, json=_body(notes="x" * 1500)).status_code == 201
    assert _row(insert)["client_notes"] == "x" * 1000


@pytest.mark.parametrize("notes", [None, "", "   \n  "])
def test_blank_notes_are_stored_as_null(client, insert, notes):
    assert client.post(URL, json=_body(notes=notes)).status_code == 201
    assert _row(insert)["client_notes"] is None


def test_junk_email_is_dropped_not_fatal(client, insert):
    assert client.post(URL, json=_body(email="not-an-email")).status_code == 201
    assert _row(insert)["client_email"] is None


def test_nul_and_lone_surrogate_never_reach_the_insert(client, insert):
    """
    Both survive JSON parsing and model validation. Postgres rejects NUL in a
    text column (a 503), and a lone surrogate makes httpx raise while encoding
    the insert (a 500), so _clean has to take them out.
    """
    body = json.dumps(_body(first="Pearl\u0000", notes="fade\ud800 please"))
    r = client.post(URL, content=body, headers={"content-type": "application/json"})
    assert r.status_code == 201
    row = _row(insert)
    assert row["client_name"] == "Pearl Krabs"
    assert row["client_notes"] == "fade please"


@pytest.mark.parametrize("first", ["", "   ", "\u200b"])
def test_blank_first_name_is_422_and_nothing_is_written(client, insert, first):
    r = client.post(URL, json=_body(first=first))
    assert r.status_code == 422
    assert r.json() == {"detail": "First name is required"}
    insert.assert_not_called()


@pytest.mark.parametrize("phone", ["555-0100", "+15555550123\n", "+1 555 555 0123"])
def test_malformed_phone_is_422_before_the_query_layer(client, insert, phone):
    assert client.post(URL, json=_body(phone=phone)).status_code == 422
    insert.assert_not_called()


def test_slot_off_the_grid_is_409(client, insert):
    assert client.post(URL, json=_body(starts_at=_slot(minute=7))).status_code == 409
    insert.assert_not_called()


def test_response_never_echoes_client_details(client, insert):
    r = client.post(URL, json=_body(notes="call me when you're free"))
    assert r.status_code == 201
    assert set(r.json()) == set(AppointmentBooked.model_fields)


@pytest.mark.parametrize(
    "error,status",
    [(SlotTaken("lost the race"), 409), (DatabaseUnavailable("boom"), 503)],
)
def test_route_maps_query_errors(client, error, status):
    with patch("server.routes.booking.make_appointment", side_effect=error):
        r = client.post(URL, json=_body())
    assert r.status_code == status
    assert str(error) not in r.text  # detail goes to logs, never to the caller
