"""
The /dashboard routes. current_user is overridden with a fixed caller, since
tests/test_me.py already covers the token check, and only the PostgREST client
is faked.
"""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from postgrest import APIError, ReturnMethod

from server.main import app
from server.routes.auth import current_user
from server.supabase import sb_function
from server.supabase.auth import Caller
from server.supabase.dashboard import get_week

URL = "/dashboard/profile"
CALLER = Caller(user_id="00000001-0000-4000-8000-000000000005", access_token="access-1")
SAVED = {
    "slug": "ada-lovelace",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "bio": "Fades and beard work.",
    "public_email": "ada@example.com",
    "public_phone": "+15125550100",
    "is_active": False,
}
BODY = {k: v for k, v in SAVED.items() if k != "is_active"}
SLUG_TAKEN = APIError(
    {
        "code": "23505",
        "message": 'duplicate key value violates unique constraint "worker_profile_slug_key"',
    }
)


@pytest.fixture(autouse=True)
def signed_in():
    """Every request runs as CALLER unless a test removes the override."""
    app.dependency_overrides[current_user] = lambda: CALLER
    yield
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture
def db():
    """
    The client user_db builds, with one mock per table so their query chains stay
    apart, and shortcuts to the three worker_profile queries.
    """
    with patch.object(sb_function, "create_client") as factory:
        tables = defaultdict(MagicMock)
        factory.return_value.table.side_effect = tables.__getitem__
        table = tables["worker_profile"]
        yield SimpleNamespace(
            factory=factory,
            tables=tables,
            table=table,
            read=table.select.return_value.eq.return_value.limit.return_value,
            update=table.update.return_value.eq.return_value,
            insert=table.insert.return_value,
        )


def rows(*data):
    return SimpleNamespace(data=list(data))


def test_get_returns_the_callers_own_profile(client, db):
    db.read.execute.return_value = rows(SAVED)

    response = client.get(URL)

    assert response.status_code == 200
    assert response.json() == SAVED
    options = db.factory.call_args.kwargs["options"]
    assert options.headers["Authorization"] == "Bearer access-1"
    db.factory.return_value.table.assert_called_once_with("worker_profile")
    db.table.select.return_value.eq.assert_called_once_with("user_id", CALLER.user_id)


def test_get_without_a_profile_is_404(client, db):
    db.read.execute.return_value = rows()

    assert client.get(URL).status_code == 404


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, 503),
        ({"return_value": rows({"slug": "ada-lovelace"})}, 503),
    ],
    ids=["token-rejected", "query-failed", "schema-mismatch"],
)
def test_get_failures(client, db, outcome, code):
    db.read.execute.configure_mock(**outcome)

    assert client.get(URL).status_code == code


def test_put_updates_the_profile_the_caller_has(client, db):
    db.update.execute.return_value = rows(SAVED)

    response = client.put(URL, json=BODY)

    assert response.status_code == 200
    assert response.json() == SAVED
    db.table.update.assert_called_once_with(BODY)
    db.table.update.return_value.eq.assert_called_once_with("user_id", CALLER.user_id)
    db.table.insert.assert_not_called()


def test_put_tidies_the_text_before_writing(client, db):
    db.update.execute.return_value = rows(SAVED)
    messy = {
        **BODY,
        "first_name": "  Ada ",
        "last_name": "Love‮lace",
        "bio": "Fades\n\nand   beard work.",
        "public_email": " ADA@Example.com ",
    }

    client.put(URL, json=messy)

    sent = db.table.update.call_args.args[0]
    assert sent["first_name"] == "Ada"
    assert sent["last_name"] == "Love lace"
    assert sent["bio"] == "Fades and beard work."
    assert sent["public_email"] == "ada@example.com"


def test_put_creates_a_hidden_profile_when_the_caller_has_none(client, db):
    db.update.execute.return_value = rows()
    db.insert.execute.return_value = rows(SAVED)

    response = client.put(URL, json=BODY)

    assert response.status_code == 200
    db.table.insert.assert_called_once_with(BODY | {"user_id": CALLER.user_id, "is_active": False})


def test_put_sends_blank_optional_fields_as_null(client, db):
    db.update.execute.return_value = rows(SAVED)

    client.put(URL, json={**BODY, "bio": "", "public_email": None, "public_phone": None})

    sent = db.table.update.call_args.args[0]
    assert (sent["bio"], sent["public_email"], sent["public_phone"]) == ("", None, None)


def test_taken_slug_is_409(client, db):
    db.update.execute.side_effect = SLUG_TAKEN

    response = client.put(URL, json=BODY)

    assert response.status_code == 409
    assert response.json() == {"detail": "That link is taken, try another"}


def test_taken_slug_on_insert_is_409(client, db):
    db.update.execute.return_value = rows()
    db.insert.execute.side_effect = SLUG_TAKEN

    assert client.put(URL, json=BODY).status_code == 409


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (
            APIError(
                {
                    "code": "23505",
                    "message": "duplicate key value violates unique constraint "
                    '"worker_profile_user_id_key"',
                }
            ),
            503,
        ),
        (APIError({"code": "PGRST303", "message": "JWT expired"}), 401),
        (APIError({"code": "42501", "message": "new row violates row-level security"}), 503),
    ],
    ids=["other-unique", "token-rejected", "rls-refused"],
)
def test_put_failures(client, db, error, code):
    db.update.execute.return_value = rows()
    db.insert.execute.side_effect = error

    assert client.put(URL, json=BODY).status_code == code


@pytest.mark.parametrize(
    ("change", "detail"),
    [
        ({"first_name": "   "}, "First and last name are required"),
        ({"last_name": "​"}, "First and last name are required"),
        ({"public_email": "not-an-email"}, "Enter a valid email address"),
    ],
    ids=["blank-first", "invisible-last", "bad-email"],
)
def test_unusable_text_is_422_and_never_queries(client, db, change, detail):
    response = client.put(URL, json={**BODY, **change})

    assert response.status_code == 422
    assert response.json() == {"detail": detail}
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    "change",
    [
        {"slug": "Ada Lovelace"},
        {"slug": "-ada"},
        {"slug": "a" * 61},
        {"public_phone": "(512) 555-0100"},
    ],
    ids=["spaces", "leading-dash", "too-long", "phone-not-e164"],
)
def test_malformed_slug_or_phone_is_422_and_never_queries(client, db, change):
    assert client.put(URL, json={**BODY, **change}).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("method", "url", "body"),
    [
        ("GET", "/dashboard/profile", None),
        ("PUT", "/dashboard/profile", BODY),
        ("GET", "/dashboard/chairs", None),
        ("PUT", "/dashboard/join-request", {"slug": "krusty-fadez"}),
        (
            "PUT",
            "/dashboard/chairs/0000000c-0000-4000-8000-000000000001/schedule",
            {"days": [{"day_of_week": 1, "start_minute": 540, "end_minute": 1020}]},
        ),
        ("GET", "/dashboard/chairs/0000000c-0000-4000-8000-000000000001/appointments", None),
        ("GET", "/dashboard/services", None),
        (
            "PUT",
            "/dashboard/services",
            {"services": [{"title": "Fade", "price_cents": 3500, "duration_min": 45}]},
        ),
    ],
)
def test_missing_token_is_401(client, db, method, url, body):
    app.dependency_overrides.pop(current_user)

    response = client.request(method, url, json=body)

    assert response.status_code == 401
    db.factory.assert_not_called()


CHAIRS_URL = "/dashboard/chairs"
JOIN_URL = "/dashboard/join-request"
SERVICES_URL = "/dashboard/services"
WORKER_ID = "00000003-0000-4000-8000-000000000009"
KRUSTY = {
    "id": "00000002-0000-4000-8000-000000000001",
    "slug": "krusty-fadez",
    "name": "Krusty Fadez",
    "timezone": "Pacific/Kwajalein",
}
REGULAR = {
    "id": "00000002-0000-4000-8000-000000000002",
    "slug": "regular-cutz",
    "name": "Regular Cutz",
    "timezone": "America/Los_Angeles",
}
CHAIR_IDS = {
    KRUSTY["id"]: "0000000c-0000-4000-8000-000000000001",
    REGULAR["id"]: "0000000c-0000-4000-8000-000000000002",
}
NEW_CHAIR = "0000000c-0000-4000-8000-000000000003"
MONDAY = {
    "day_of_week": 1,
    "start_minute": 540,
    "end_minute": 1020,
    "break_start_minute": 720,
    "break_end_minute": 780,
}
TUESDAY = {
    "day_of_week": 2,
    "start_minute": 600,
    "end_minute": 1080,
    "break_start_minute": None,
    "break_end_minute": None,
}


def chair(shop, is_active=False, ended_at=None, days=()):
    """One worker_establishment row with its shop and hours embedded."""
    return {
        "id": CHAIR_IDS[shop["id"]],
        "is_active": is_active,
        "ended_at": ended_at,
        "establishment": shop,
        "worker_schedule_day": list(days),
    }


def mine(*chairs):
    """The caller's worker_profile row with their chairs embedded."""
    return {"id": WORKER_ID, "worker_establishment": list(chairs)}


@pytest.fixture
def join(db):
    """The establishment lookup and the worker_establishment writes a join request runs."""
    chairs = db.tables["worker_establishment"]
    chairs.insert.return_value.execute.return_value = rows({"id": NEW_CHAIR})
    return SimpleNamespace(
        shops=db.tables["establishment"],
        lookup=db.tables[
            "establishment"
        ].select.return_value.eq.return_value.eq.return_value.limit.return_value,
        delete=chairs.delete,
        insert=chairs.insert,
    )


def test_chairs_lists_waiting_and_joined_but_not_ended(client, db):
    db.read.execute.return_value = rows(
        mine(
            chair(KRUSTY, days=[TUESDAY, MONDAY]),
            chair(REGULAR, is_active=True),
            chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00"),
        )
    )

    response = client.get(CHAIRS_URL)

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": CHAIR_IDS[KRUSTY["id"]],
            "shop": {"slug": "krusty-fadez", "name": "Krusty Fadez"},
            "is_active": False,
            "schedule_days": [MONDAY, TUESDAY],
        },
        {
            "id": CHAIR_IDS[REGULAR["id"]],
            "shop": {"slug": "regular-cutz", "name": "Regular Cutz"},
            "is_active": True,
            "schedule_days": [],
        },
    ]
    db.factory.return_value.table.assert_called_once_with("worker_profile")
    db.table.select.return_value.eq.assert_called_once_with("user_id", CALLER.user_id)


def test_chairs_without_a_profile_is_empty(client, db):
    db.read.execute.return_value = rows()

    response = client.get(CHAIRS_URL)

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, 503),
        ({"return_value": rows({"id": WORKER_ID})}, 503),
    ],
    ids=["token-rejected", "query-failed", "schema-mismatch"],
)
def test_chairs_failures(client, db, outcome, code):
    db.read.execute.configure_mock(**outcome)

    assert client.get(CHAIRS_URL).status_code == code


def test_join_sends_the_shop_a_waiting_request(client, db, join):
    join.lookup.execute.return_value = rows(KRUSTY)
    db.read.execute.return_value = rows(mine())

    response = client.put(JOIN_URL, json={"slug": "krusty-fadez"})

    assert response.status_code == 200
    assert response.json() == {
        "id": NEW_CHAIR,
        "shop": {"slug": "krusty-fadez", "name": "Krusty Fadez"},
        "is_active": False,
        "schedule_days": [],
    }
    join.shops.select.return_value.eq.assert_called_once_with("slug", "krusty-fadez")
    join.shops.select.return_value.eq.return_value.eq.assert_called_once_with("is_active", True)
    join.insert.assert_called_once_with(
        {"worker_id": WORKER_ID, "establishment_id": KRUSTY["id"], "is_active": False}
    )


def test_join_withdraws_only_the_callers_waiting_requests_elsewhere(client, db, join):
    join.lookup.execute.return_value = rows(KRUSTY)
    db.read.execute.return_value = rows(mine(chair(REGULAR)))

    client.put(JOIN_URL, json={"slug": "krusty-fadez"})

    join.delete.assert_called_once_with(returning=ReturnMethod.minimal)
    by_worker = join.delete.return_value.eq
    waiting = by_worker.return_value.eq
    not_ended = waiting.return_value.is_
    elsewhere = not_ended.return_value.neq
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert waiting.call_args == call("is_active", False)
    assert not_ended.call_args == call("ended_at", None)
    assert elsewhere.call_args == call("establishment_id", KRUSTY["id"])
    elsewhere.return_value.execute.assert_called_once()
    join.insert.assert_called_once()


@pytest.mark.parametrize("joined", [False, True], ids=["still-waiting", "already-joined"])
def test_join_again_sends_nothing_new(client, db, join, joined):
    join.lookup.execute.return_value = rows(KRUSTY)
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=joined, days=[MONDAY])))

    response = client.put(JOIN_URL, json={"slug": "krusty-fadez"})

    assert response.status_code == 200
    assert response.json()["id"] == CHAIR_IDS[KRUSTY["id"]]
    assert response.json()["is_active"] is joined
    assert response.json()["schedule_days"] == [MONDAY]
    join.insert.assert_not_called()


def test_join_after_an_ended_stint_sends_a_new_request(client, db, join):
    join.lookup.execute.return_value = rows(KRUSTY)
    db.read.execute.return_value = rows(mine(chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00")))

    response = client.put(JOIN_URL, json={"slug": "krusty-fadez"})

    assert response.json()["id"] == NEW_CHAIR
    join.insert.assert_called_once()


def test_unknown_or_hidden_shop_is_404_and_writes_nothing(client, db, join):
    join.lookup.execute.return_value = rows()

    response = client.put(JOIN_URL, json={"slug": "nope"})

    assert response.status_code == 404
    assert response.json() == {"detail": "That's not an existing shop"}
    join.delete.assert_not_called()
    join.insert.assert_not_called()


def test_join_without_a_profile_is_409_and_writes_nothing(client, db, join):
    join.lookup.execute.return_value = rows(KRUSTY)
    db.read.execute.return_value = rows()

    response = client.put(JOIN_URL, json={"slug": "krusty-fadez"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Set up your profile first"}
    join.delete.assert_not_called()
    join.insert.assert_not_called()


@pytest.mark.parametrize(
    "slug", ["Krusty Fadez", "", "-krusty", "k" * 61], ids=["spaces", "empty", "dash", "long"]
)
def test_malformed_shop_slug_is_422_and_never_queries(client, db, slug):
    assert client.put(JOIN_URL, json={"slug": slug}).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("lookup", "insert", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, {}, 401),
        ({"return_value": rows({"slug": "krusty-fadez"})}, {}, 503),
        (
            {"return_value": rows(KRUSTY)},
            {"side_effect": APIError({"code": "42501", "message": "row-level security"})},
            503,
        ),
        ({"return_value": rows(KRUSTY)}, {"return_value": rows()}, 503),
    ],
    ids=["token-rejected", "schema-mismatch", "insert-refused", "insert-returned-nothing"],
)
def test_join_failures(client, db, join, lookup, insert, code):
    join.lookup.execute.configure_mock(**lookup)
    db.read.execute.return_value = rows(mine())
    join.insert.return_value.execute.configure_mock(**insert)

    assert client.put(JOIN_URL, json={"slug": "krusty-fadez"}).status_code == code


def schedule_url(chair_id=CHAIR_IDS[KRUSTY["id"]]):
    return f"/dashboard/chairs/{chair_id}/schedule"


@pytest.fixture
def hours(db):
    """The worker_schedule_day writes, with the caller waiting on a chair at Krusty Fadez."""
    db.read.execute.return_value = rows(mine(chair(KRUSTY)))
    days = db.tables["worker_schedule_day"]
    return SimpleNamespace(upsert=days.upsert, delete=days.delete)


def test_hours_write_the_open_days_and_close_the_rest(client, db, hours):
    response = client.put(schedule_url(), json={"days": [TUESDAY, MONDAY]})

    assert response.status_code == 200
    assert response.json() == [MONDAY, TUESDAY]
    chair_id = CHAIR_IDS[KRUSTY["id"]]
    hours.upsert.assert_called_once_with(
        [
            TUESDAY | {"worker_establishment_id": chair_id},
            MONDAY | {"worker_establishment_id": chair_id},
        ],
        on_conflict="worker_establishment_id,day_of_week",
        returning=ReturnMethod.minimal,
    )
    hours.delete.assert_called_once_with(returning=ReturnMethod.minimal)
    this_chair = hours.delete.return_value.eq
    closed = this_chair.return_value.in_
    assert this_chair.call_args == call("worker_establishment_id", chair_id)
    assert closed.call_args == call("day_of_week", [0, 3, 4, 5, 6])
    closed.return_value.execute.assert_called_once()


def test_hours_open_all_week_close_nothing(client, db, hours):
    week = [MONDAY | {"day_of_week": d} for d in range(7)]

    assert client.put(schedule_url(), json={"days": week}).status_code == 200
    hours.delete.assert_not_called()


@pytest.mark.parametrize(
    ("held", "chair_id"),
    [
        (mine(chair(KRUSTY)), NEW_CHAIR),
        (mine(chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00")), CHAIR_IDS[KRUSTY["id"]]),
        (None, CHAIR_IDS[KRUSTY["id"]]),
    ],
    ids=["someone-elses-chair", "ended-chair", "no-profile"],
)
def test_hours_for_a_chair_the_caller_doesnt_hold_are_404(client, db, hours, held, chair_id):
    db.read.execute.return_value = rows() if held is None else rows(held)

    response = client.put(schedule_url(chair_id), json={"days": [MONDAY]})

    assert response.status_code == 404
    hours.upsert.assert_not_called()
    hours.delete.assert_not_called()


@pytest.mark.parametrize(
    "days",
    [
        [MONDAY | {"end_minute": 500}],
        [MONDAY | {"break_end_minute": None}],
        [MONDAY | {"break_start_minute": 480, "break_end_minute": 600}],
        [MONDAY | {"break_start_minute": 780, "break_end_minute": 720}],
        [MONDAY, MONDAY],
        [],
        [MONDAY | {"day_of_week": 7}],
        [MONDAY | {"end_minute": 1441}],
    ],
    ids=[
        "ends-before-start",
        "half-a-break",
        "break-outside",
        "break-backwards",
        "repeated-day",
        "empty-week",
        "no-such-day",
        "past-midnight",
    ],
)
def test_bad_hours_are_422_and_never_query(client, db, days):
    assert client.put(schedule_url(), json={"days": days}).status_code == 422
    db.factory.assert_not_called()


def test_hours_for_a_malformed_chair_id_are_422(client, db):
    assert client.put(schedule_url("chair-1"), json={"days": [MONDAY]}).status_code == 422
    db.factory.assert_not_called()


def test_hours_write_refused_is_503(client, db, hours):
    hours.upsert.return_value.execute.side_effect = APIError(
        {"code": "42501", "message": "row-level security"}
    )

    assert client.put(schedule_url(), json={"days": [MONDAY]}).status_code == 503


# 13:00 UTC on Friday, October 30, 2026, which is already Saturday the 31st in Kwajalein.
NOW = datetime(2026, 10, 30, 13, 0, tzinfo=UTC)
KWAJALEIN = ZoneInfo("Pacific/Kwajalein")
SAT_31 = date(2026, 10, 31)
MON_2 = date(2026, 11, 2)
TUE_3 = date(2026, 11, 3)


def week_url(chair_id=CHAIR_IDS[KRUSTY["id"]]):
    return f"/dashboard/chairs/{chair_id}/appointments"


def at_krusty(day, clock):
    """An instant on Krusty Fadez's clock, written the way PostgREST writes it."""
    local = datetime.combine(day, time.fromisoformat(clock), tzinfo=KWAJALEIN)
    return local.astimezone(UTC).isoformat()


def booking(starts_at, status="ACCEPTED", **row):
    """One appointment row as the week reads it."""
    return {
        "id": "00000007-0000-4000-8000-000000000001",
        "starts_at": starts_at,
        "duration_min": 45,
        "client_name": "Pearl Krabs",
        "service_title": "The Bubble Fade",
        "price_cents": 2500,
        "status": status,
    } | row


@pytest.fixture
def week(db):
    """The bookings and time off a week reads, both empty unless a test fills them."""
    appointment = db.tables["appointment"]
    time_off = db.tables["worker_time_off"]
    bookings = appointment.select.return_value.eq.return_value.eq.return_value
    bookings = bookings.gte.return_value.lt.return_value.neq.return_value.order.return_value
    away = time_off.select.return_value.eq.return_value.lt.return_value.gt.return_value
    bookings.execute.return_value = rows()
    away.execute.return_value = rows()
    return SimpleNamespace(appointment=appointment, time_off=time_off, bookings=bookings, away=away)


def week_at_krusty(db, *hours):
    """The week at the caller's Krusty Fadez chair, open on these days, as of NOW."""
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True, days=hours)))
    return get_week(CALLER, UUID(CHAIR_IDS[KRUSTY["id"]]), now_utc=NOW)


def test_week_runs_seven_days_from_the_shops_today(db, week):
    found = week_at_krusty(db, MONDAY, TUESDAY)

    assert found.timezone == "Pacific/Kwajalein"
    assert [d.day for d in found.days] == [SAT_31 + timedelta(days=i) for i in range(7)]
    assert [d.day_off for d in found.days] == [True, True, False, False, True, True, True]


def test_week_reads_the_callers_bookings_here_between_the_shops_midnights(db, week):
    week_at_krusty(db, MONDAY)

    lo, hi = "2026-10-30T12:00:00+00:00", "2026-11-06T12:00:00+00:00"
    by_worker = week.appointment.select.return_value.eq
    at_shop = by_worker.return_value.eq
    starting = at_shop.return_value.gte
    before = starting.return_value.lt
    listed = before.return_value.neq
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert at_shop.call_args == call("establishment_id", KRUSTY["id"])
    assert starting.call_args == call("starts_at", lo)
    assert before.call_args == call("starts_at", hi)
    assert listed.call_args == call("status", "CANCELLED")
    assert listed.return_value.order.call_args == call("starts_at")
    away = week.time_off.select.return_value.eq
    assert away.call_args == call("worker_id", WORKER_ID)
    assert away.return_value.lt.call_args == call("starts", hi)
    assert away.return_value.lt.return_value.gt.call_args == call("ends", lo)


def test_week_files_each_booking_under_the_shops_own_day(db, week):
    late = booking(at_krusty(SAT_31, "23:30"))
    early = booking(
        at_krusty(SAT_31 + timedelta(days=1), "00:30"), id="00000007-0000-4000-8000-000000000002"
    )
    week.bookings.execute.return_value = rows(late, early)

    days = week_at_krusty(db, MONDAY).days

    assert [[str(a.id) for a in d.appointments] for d in days[:2]] == [[late["id"]], [early["id"]]]
    # Saturday has no hours, and its booking is still listed.
    assert days[0].day_off is True


@pytest.mark.parametrize(
    ("stretches", "off"),
    [
        ([], False),
        ([(at_krusty(MON_2, "00:00"), at_krusty(TUE_3, "00:00"))], True),
        (
            [
                (at_krusty(MON_2, "09:00"), at_krusty(MON_2, "12:00")),
                (at_krusty(MON_2, "13:00"), at_krusty(MON_2, "17:00")),
            ],
            True,
        ),
        ([(at_krusty(MON_2, "10:00"), at_krusty(MON_2, "12:00"))], False),
    ],
    ids=["no-time-off", "all-day", "around-the-break", "part-of-the-day"],
)
def test_a_day_with_hours_is_off_only_when_time_off_covers_them(db, week, stretches, off):
    week.away.execute.return_value = rows(*({"starts": s, "ends": e} for s, e in stretches))

    days = {d.day: d.day_off for d in week_at_krusty(db, MONDAY, TUESDAY).days}

    assert days[MON_2] is off
    assert days[TUE_3] is False


def test_week_sends_only_what_a_row_shows(client, db, week):
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True, days=[MONDAY])))
    soon = (datetime.now(UTC) + timedelta(hours=1)).replace(microsecond=0)
    week.bookings.execute.return_value = rows(
        booking(soon.isoformat(), "PENDING", client_phone="+16925552003", client_notes="Meow.")
    )

    response = client.get(week_url())

    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "Pacific/Kwajalein"
    assert len(body["days"]) == 7
    [listed] = [a for d in body["days"] for a in d["appointments"]]
    assert set(listed) == {
        "id",
        "starts_at",
        "duration_min",
        "client_name",
        "service_title",
        "price_cents",
        "status",
    }
    assert datetime.fromisoformat(listed["starts_at"]) == soon
    assert listed["status"] == "PENDING"


@pytest.mark.parametrize(
    ("held", "chair_id"),
    [
        (mine(chair(KRUSTY, is_active=True)), NEW_CHAIR),
        (mine(chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00")), CHAIR_IDS[KRUSTY["id"]]),
        (None, CHAIR_IDS[KRUSTY["id"]]),
    ],
    ids=["someone-elses-chair", "ended-chair", "no-profile"],
)
def test_week_at_a_chair_the_caller_doesnt_hold_is_404(client, db, week, held, chair_id):
    db.read.execute.return_value = rows() if held is None else rows(held)

    response = client.get(week_url(chair_id))

    assert response.status_code == 404
    week.appointment.select.assert_not_called()


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, 503),
        ({"return_value": rows({"id": "00000007-0000-4000-8000-000000000001"})}, 503),
    ],
    ids=["token-rejected", "query-failed", "schema-mismatch"],
)
def test_week_failures(client, db, week, outcome, code):
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True)))
    week.bookings.execute.configure_mock(**outcome)

    assert client.get(week_url()).status_code == code


def test_week_at_a_shop_with_an_unknown_time_zone_is_503(client, db, week):
    lost = KRUSTY | {"timezone": "Bikini/Bottom"}
    db.read.execute.return_value = rows(mine(chair(lost, is_active=True)))

    assert client.get(week_url()).status_code == 503
    week.appointment.select.assert_not_called()


SKIN_FADE = {
    "id": "0000000d-0000-4000-8000-000000000001",
    "title": "Skin fade",
    "description": "Includes lineup.",
    "price_cents": 3500,
    "duration_min": 45,
    "buffer_after_min": 10,
}
BEARD_TRIM = {
    "id": "0000000d-0000-4000-8000-000000000002",
    "title": "Beard trim",
    "description": "",
    "price_cents": 2000,
    "duration_min": 20,
    "buffer_after_min": 0,
}
KIDS_CUT = {
    "title": "Kids cut",
    "description": "Under 12.",
    "price_cents": 2500,
    "duration_min": 30,
    "buffer_after_min": 5,
}


def menu(*services):
    """The caller's worker_profile row with the services they offer embedded."""
    return {"id": WORKER_ID, "service": list(services)}


def without_id(service):
    return {k: v for k, v in service.items() if k != "id"}


@pytest.fixture
def services(db):
    """The services read, filtered to offered and oldest first, and the three writes."""
    table = db.tables["service"]
    by_user = db.table.select.return_value.eq
    return SimpleNamespace(
        by_user=by_user,
        read=by_user.return_value.eq.return_value.order.return_value.limit.return_value,
        update=table.update,
        upsert=table.upsert,
        insert=table.insert,
    )


def test_services_lists_what_the_caller_offers_oldest_first(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE, BEARD_TRIM))

    response = client.get(SERVICES_URL)

    assert response.status_code == 200
    assert response.json() == [SKIN_FADE, BEARD_TRIM]
    assert services.by_user.call_args == call("user_id", CALLER.user_id)
    offered = services.by_user.return_value.eq
    assert offered.call_args == call("service.is_active", True)
    assert offered.return_value.order.call_args == call("created_at", foreign_table="service")


def test_services_without_a_profile_is_empty(client, db, services):
    services.read.execute.return_value = rows()

    assert client.get(SERVICES_URL).json() == []


def test_saving_the_menu_turns_off_updates_and_adds(client, db, services):
    edited = SKIN_FADE | {"price_cents": 4000}
    saved = KIDS_CUT | {"id": "0000000d-0000-4000-8000-000000000003"}
    services.read.execute.side_effect = [
        rows(menu(SKIN_FADE, BEARD_TRIM)),
        rows(menu(edited, saved)),
    ]

    response = client.put(SERVICES_URL, json={"services": [edited, KIDS_CUT]})

    assert response.status_code == 200
    assert response.json() == [edited, saved]
    services.update.assert_called_once_with({"is_active": False}, returning=ReturnMethod.minimal)
    by_worker = services.update.return_value.eq
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert by_worker.return_value.in_.call_args == call("id", [BEARD_TRIM["id"]])
    services.upsert.assert_called_once_with(
        [edited | {"worker_id": WORKER_ID}],
        on_conflict="id",
        returning=ReturnMethod.minimal,
    )
    services.insert.assert_called_once_with(
        [KIDS_CUT | {"worker_id": WORKER_ID}], returning=ReturnMethod.minimal
    )


def test_an_id_that_isnt_the_callers_is_added_as_new(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE))
    stranger = KIDS_CUT | {"id": "0000000d-0000-4000-8000-000000000099"}

    client.put(SERVICES_URL, json={"services": [SKIN_FADE, stranger]})

    services.insert.assert_called_once_with(
        [KIDS_CUT | {"worker_id": WORKER_ID}], returning=ReturnMethod.minimal
    )
    services.update.assert_not_called()


def test_an_unchanged_menu_only_updates(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE))

    client.put(SERVICES_URL, json={"services": [SKIN_FADE]})

    services.upsert.assert_called_once()
    services.update.assert_not_called()
    services.insert.assert_not_called()


def test_saving_the_menu_tidies_the_text(client, db, services):
    services.read.execute.return_value = rows(menu())
    messy = without_id(SKIN_FADE) | {"title": "  Skin ‮ fade ", "description": "A\n\nB"}

    client.put(SERVICES_URL, json={"services": [messy]})

    sent = services.insert.call_args.args[0][0]
    assert (sent["title"], sent["description"]) == ("Skin fade", "A B")


def test_blank_service_name_is_422_and_never_queries(client, db):
    blank = without_id(SKIN_FADE) | {"title": " ​ "}

    response = client.put(SERVICES_URL, json={"services": [blank]})

    assert response.status_code == 422
    assert response.json() == {"detail": "Every service needs a name"}
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    "posted",
    [
        [SKIN_FADE, SKIN_FADE],
        [],
        [without_id(SKIN_FADE)] * 51,
        [SKIN_FADE | {"price_cents": -1}],
        [SKIN_FADE | {"duration_min": 0}],
        [SKIN_FADE | {"duration_min": 1441}],
        [SKIN_FADE | {"buffer_after_min": 481}],
    ],
    ids=[
        "repeated-id",
        "empty",
        "too-many",
        "negative-price",
        "no-duration",
        "too-long",
        "big-buffer",
    ],
)
def test_bad_menu_is_422_and_never_queries(client, db, posted):
    assert client.put(SERVICES_URL, json={"services": posted}).status_code == 422
    db.factory.assert_not_called()


def test_saving_a_menu_without_a_profile_is_409_and_writes_nothing(client, db, services):
    services.read.execute.return_value = rows()

    response = client.put(SERVICES_URL, json={"services": [SKIN_FADE]})

    assert response.status_code == 409
    services.update.assert_not_called()
    services.upsert.assert_not_called()
    services.insert.assert_not_called()


@pytest.mark.parametrize(
    ("read", "insert", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, {}, 401),
        ({"return_value": rows({"id": WORKER_ID})}, {}, 503),
        (
            {"return_value": rows(menu())},
            {"side_effect": APIError({"code": "42501", "message": "row-level security"})},
            503,
        ),
    ],
    ids=["token-rejected", "schema-mismatch", "insert-refused"],
)
def test_saving_the_menu_failures(client, db, services, read, insert, code):
    services.read.execute.configure_mock(**read)
    services.insert.return_value.execute.configure_mock(**insert)

    response = client.put(SERVICES_URL, json={"services": [without_id(SKIN_FADE)]})

    assert response.status_code == code
