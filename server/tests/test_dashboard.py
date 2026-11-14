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
from server.models.dashboard import Answer, SaveStretch
from server.routes.auth import current_user
from server.supabase import sb_function
from server.supabase.auth import Caller
from server.supabase.dashboard import (
    answer_join_request,
    answer_request,
    get_time_off,
    get_week,
    save_time_off,
)

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
        ("GET", "/dashboard/join-requests", None),
        (
            "PUT",
            "/dashboard/join-requests/0000000c-0000-4000-8000-000000000004",
            {"status": "ACCEPTED"},
        ),
        (
            "POST",
            "/dashboard/shops",
            {
                "slug": "main-street-studio",
                "name": "Main Street Studio",
                "address": "12 Main St",
                "city": "Boise",
                "state": "ID",
                "zip": "83702",
                "timezone": "America/Boise",
            },
        ),
        (
            "PUT",
            "/dashboard/chairs/0000000c-0000-4000-8000-000000000001/schedule",
            {"days": [{"day_of_week": 1, "start_minute": 540, "end_minute": 1020}]},
        ),
        ("GET", "/dashboard/chairs/0000000c-0000-4000-8000-000000000001/appointments", None),
        (
            "PUT",
            "/dashboard/appointments/00000007-0000-4000-8000-000000000001/status",
            {"status": "ACCEPTED"},
        ),
        ("GET", "/dashboard/services", None),
        (
            "PUT",
            "/dashboard/services",
            {"services": [{"title": "Fade", "price_cents": 3500, "duration_min": 45}]},
        ),
        ("GET", "/dashboard/time-off?chair=0000000c-0000-4000-8000-000000000001", None),
        (
            "PUT",
            "/dashboard/time-off?chair=0000000c-0000-4000-8000-000000000001",
            {"stretches": []},
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


SHOPS_URL = "/dashboard/shops"
NEW_SHOP = {
    "slug": "main-street-studio",
    "name": "Main Street Studio",
    "address": "12 Main St",
    "city": "Boise",
    "state": "ID",
    "zip": "83702",
    "timezone": "America/Boise",
    "phone": "+12085550100",
    "email": "hi@mainstreet.test",
    "description": "Fades since 1998.",
    "hours": {"mon": {"open": "09:00", "close": "21:00"}},
}
SHOP_SLUG_TAKEN = APIError(
    {
        "code": "23505",
        "message": 'duplicate key value violates unique constraint "establishment_slug_key"',
    }
)


@pytest.fixture
def new_shop(db):
    """The create_establishment call, the owner lookup, and the withdraw a new shop runs."""
    rpc = db.factory.return_value.rpc
    rpc.return_value.execute.return_value = SimpleNamespace(data=NEW_CHAIR)
    owners = db.tables["establishment_owner"]
    chairs = db.tables["worker_establishment"]
    return SimpleNamespace(
        rpc=rpc,
        owners=owners,
        owner=owners.select.return_value.eq.return_value.eq.return_value.limit.return_value,
        delete=chairs.delete,
        withdraw=chairs.delete.return_value.eq.return_value.eq.return_value.is_.return_value,
    )


def test_new_shop_makes_the_caller_its_owner_with_a_joined_chair(client, db, new_shop):
    db.read.execute.return_value = rows(mine())

    response = client.post(SHOPS_URL, json=NEW_SHOP)

    assert response.status_code == 201
    assert response.json() == {
        "id": NEW_CHAIR,
        "shop": {"slug": "main-street-studio", "name": "Main Street Studio"},
        "is_active": True,
        "schedule_days": [],
    }
    new_shop.rpc.assert_called_once_with("create_establishment", NEW_SHOP)


def test_new_shop_runs_as_the_caller_on_the_public_key(client, db, new_shop):
    db.read.execute.return_value = rows(mine())

    client.post(SHOPS_URL, json=NEW_SHOP)

    assert db.factory.call_args.args[1] == "test-publishable"
    options = db.factory.call_args.kwargs["options"]
    assert options.headers["Authorization"] == "Bearer access-1"


def test_new_shop_tidies_the_text_before_creating(client, db, new_shop):
    db.read.execute.return_value = rows(mine())
    posted = {k: v for k, v in NEW_SHOP.items() if k not in ("phone", "hours")} | {
        "name": "  Main   Street\tStudio ",
        "city": "Boise\u202e",
        "email": " HI@MainStreet.test ",
        "description": "Fades since 1998.\n\nWalk-ins welcome.",
    }

    response = client.post(SHOPS_URL, json=posted)

    assert response.json()["shop"]["name"] == "Main Street Studio"
    params = new_shop.rpc.call_args.args[1]
    assert params["name"] == "Main Street Studio"
    assert params["city"] == "Boise"
    assert params["email"] == "hi@mainstreet.test"
    assert params["description"] == "Fades since 1998. Walk-ins welcome."
    assert params["phone"] is None
    assert params["hours"] is None


def test_new_shop_caps_the_text(client, db, new_shop):
    db.read.execute.return_value = rows(mine())

    client.post(SHOPS_URL, json=NEW_SHOP | {"name": "n" * 150, "description": "d" * 1500})

    params = new_shop.rpc.call_args.args[1]
    assert params["name"] == "n" * 100
    assert params["description"] == "d" * 1000


def test_new_shop_withdraws_the_callers_waiting_requests(client, db, new_shop):
    db.read.execute.return_value = rows(mine(chair(REGULAR)))

    client.post(SHOPS_URL, json=NEW_SHOP)

    new_shop.delete.assert_called_once_with(returning=ReturnMethod.minimal)
    by_worker = new_shop.delete.return_value.eq
    waiting = by_worker.return_value.eq
    not_ended = waiting.return_value.is_
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert waiting.call_args == call("is_active", False)
    assert not_ended.call_args == call("ended_at", None)
    new_shop.withdraw.neq.assert_not_called()
    new_shop.withdraw.execute.assert_called_once()


def test_posting_the_same_shop_again_returns_its_chair(client, db, new_shop):
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True, days=[MONDAY])))
    new_shop.rpc.return_value.execute.side_effect = SHOP_SLUG_TAKEN
    new_shop.owner.execute.return_value = rows({"id": "0000000a-0000-4000-8000-000000000001"})

    response = client.post(SHOPS_URL, json=NEW_SHOP | {"slug": "krusty-fadez"})

    assert response.status_code == 201
    assert response.json() == {
        "id": CHAIR_IDS[KRUSTY["id"]],
        "shop": {"slug": "krusty-fadez", "name": "Krusty Fadez"},
        "is_active": True,
        "schedule_days": [MONDAY],
    }
    by_user = new_shop.owners.select.return_value.eq
    assert by_user.call_args == call("user_id", CALLER.user_id)
    assert by_user.return_value.eq.call_args == call("establishment_id", KRUSTY["id"])
    new_shop.withdraw.execute.assert_called_once()


@pytest.mark.parametrize(
    ("held", "owned"),
    [
        (mine(), rows({"id": "0000000a-0000-4000-8000-000000000001"})),
        (mine(chair(KRUSTY, is_active=True)), rows()),
        (mine(chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00")), rows({"id": "x"})),
    ],
    ids=["no-chair-there", "not-the-owner", "ended-chair"],
)
def test_a_slug_another_shop_uses_is_409_and_withdraws_nothing(client, db, new_shop, held, owned):
    db.read.execute.return_value = rows(held)
    new_shop.rpc.return_value.execute.side_effect = SHOP_SLUG_TAKEN
    new_shop.owner.execute.return_value = owned

    response = client.post(SHOPS_URL, json=NEW_SHOP | {"slug": "krusty-fadez"})

    assert response.status_code == 409
    assert response.json() == {"detail": "That link is taken, try another"}
    new_shop.delete.assert_not_called()


def test_new_shop_without_a_profile_is_409_and_never_creates(client, db, new_shop):
    db.read.execute.return_value = rows()

    response = client.post(SHOPS_URL, json=NEW_SHOP)

    assert response.status_code == 409
    assert response.json() == {"detail": "Set up your profile first"}
    new_shop.rpc.assert_not_called()
    new_shop.delete.assert_not_called()


@pytest.mark.parametrize(
    ("change", "detail"),
    [
        ({"name": " \u200b "}, "Fill in the shop's name and address"),
        ({"address": "\u202e"}, "Fill in the shop's name and address"),
        ({"zip": "   "}, "Fill in the shop's name and address"),
        ({"email": "not-an-email"}, "Enter a valid email address"),
    ],
    ids=["blank-name", "invisible-address", "blank-zip", "bad-email"],
)
def test_blank_shop_text_is_422_and_never_queries(client, db, change, detail):
    response = client.post(SHOPS_URL, json=NEW_SHOP | change)

    assert response.status_code == 422
    assert response.json() == {"detail": detail}
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    "posted",
    [
        NEW_SHOP | {"slug": "Main Street"},
        NEW_SHOP | {"slug": "m" * 61},
        NEW_SHOP | {"phone": "(208) 555-0100"},
        NEW_SHOP | {"timezone": "America/Boisee"},
        NEW_SHOP | {"timezone": ""},
        NEW_SHOP | {"hours": {"mon": {"open": "21:00", "close": "09:00"}}},
        NEW_SHOP | {"hours": {"mon": {"open": "09:00", "close": "09:00"}}},
        NEW_SHOP | {"hours": {"mon": {"open": "9:00", "close": "21:00"}}},
        NEW_SHOP | {"hours": {"mon": {"open": "09:00", "close": "24:00"}}},
        NEW_SHOP | {"hours": {"mon": {"open": "09:00"}}},
        NEW_SHOP | {"hours": {"funday": {"open": "09:00", "close": "21:00"}}},
        {k: v for k, v in NEW_SHOP.items() if k != "name"},
    ],
    ids=[
        "slug-spaces",
        "slug-long",
        "phone-not-e164",
        "timezone-typo",
        "timezone-empty",
        "closes-before-it-opens",
        "closes-as-it-opens",
        "time-not-padded",
        "time-past-midnight",
        "no-close",
        "unknown-day",
        "no-name",
    ],
)
def test_malformed_shop_is_422_and_never_queries(client, db, posted):
    assert client.post(SHOPS_URL, json=posted).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("rpc", "withdraw", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, {}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, {}, 503),
        ({"side_effect": SLUG_TAKEN}, {}, 503),
        ({"return_value": SimpleNamespace(data=[])}, {}, 503),
        ({}, {"side_effect": APIError({"code": "42501", "message": "row-level security"})}, 503),
    ],
    ids=["token-rejected", "create-refused", "other-slug-key", "no-chair-id", "withdraw-refused"],
)
def test_new_shop_failures(client, db, new_shop, rpc, withdraw, code):
    db.read.execute.return_value = rows(mine())
    new_shop.rpc.return_value.execute.configure_mock(**rpc)
    new_shop.withdraw.execute.configure_mock(**withdraw)

    assert client.post(SHOPS_URL, json=NEW_SHOP).status_code == code


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


APPOINTMENT_ID = "00000007-0000-4000-8000-000000000001"
ROW_COLS = "id, starts_at, duration_min, client_name, service_title, price_cents, status"
ROW_KEYS = set(ROW_COLS.split(", "))


def answer_url(appointment_id=APPOINTMENT_ID):
    return f"/dashboard/appointments/{appointment_id}/status"


@pytest.fixture
def answer(db):
    """
    The caller's profile, the guarded update an answer runs, and the read that
    explains an update that matched nothing. Both match nothing unless a test fills them.
    """
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True)))
    appointment = db.tables["appointment"]
    pending = appointment.update.return_value.eq.return_value.eq.return_value.eq.return_value
    updated = pending.select.return_value
    reread = appointment.select.return_value.eq.return_value.eq.return_value.limit.return_value
    updated.execute.return_value = rows()
    reread.execute.return_value = rows()
    return SimpleNamespace(appointment=appointment, pending=pending, updated=updated, reread=reread)


def test_accepting_clears_the_hold_on_the_callers_pending_booking(db, answer):
    answer.updated.execute.return_value = rows(booking(at_krusty(MON_2, "09:00")))

    found = answer_request(CALLER, UUID(APPOINTMENT_ID), Answer.ACCEPTED, now_utc=NOW)

    assert found.status == "ACCEPTED"
    assert answer.appointment.update.call_args == call(
        {"status": "ACCEPTED", "hold_expires_at": None}
    )
    by_id = answer.appointment.update.return_value.eq
    by_worker = by_id.return_value.eq
    assert by_id.call_args == call("id", APPOINTMENT_ID)
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert by_worker.return_value.eq.call_args == call("status", "PENDING")
    assert answer.pending.select.call_args == call(ROW_COLS)
    answer.appointment.select.assert_not_called()


def test_rejecting_also_says_the_worker_did_it_and_when(db, answer):
    answer.updated.execute.return_value = rows(booking(at_krusty(MON_2, "09:00"), "REJECTED"))

    found = answer_request(CALLER, UUID(APPOINTMENT_ID), Answer.REJECTED, now_utc=NOW)

    assert found.status == "REJECTED"
    assert answer.appointment.update.call_args == call(
        {
            "status": "REJECTED",
            "hold_expires_at": None,
            "cancelled_by": "WORKER",
            "cancelled_at": "2026-10-30T13:00:00+00:00",
        }
    )


def test_answer_sends_only_what_a_row_shows(client, db, answer):
    answer.updated.execute.return_value = rows(
        booking(at_krusty(MON_2, "09:00"), client_phone="+16925552003", client_notes="Meow.")
    )

    response = client.put(answer_url(), json={"status": "ACCEPTED"})

    assert response.status_code == 200
    assert set(response.json()) == ROW_KEYS
    assert response.json()["status"] == "ACCEPTED"


@pytest.mark.parametrize(
    ("now", "asked", "code"),
    [
        ("ACCEPTED", "ACCEPTED", 200),
        ("REJECTED", "REJECTED", 200),
        ("REJECTED", "ACCEPTED", 409),
        ("ACCEPTED", "REJECTED", 409),
        ("CANCELLED", "ACCEPTED", 409),
    ],
    ids=[
        "accepted-again",
        "rejected-again",
        "accept-after-reject",
        "reject-after-accept",
        "accept-after-cancel",
    ],
)
def test_answering_a_booking_that_isnt_pending_anymore(client, db, answer, now, asked, code):
    answer.reread.execute.return_value = rows(booking(at_krusty(MON_2, "09:00"), now))

    response = client.put(answer_url(), json={"status": asked})

    assert response.status_code == code
    by_id = answer.appointment.select.return_value.eq
    assert answer.appointment.select.call_args == call(ROW_COLS)
    assert by_id.call_args == call("id", APPOINTMENT_ID)
    assert by_id.return_value.eq.call_args == call("worker_id", WORKER_ID)


def test_answer_for_a_booking_the_caller_doesnt_have_is_404(client, db, answer):
    assert client.put(answer_url(), json={"status": "ACCEPTED"}).status_code == 404


def test_answer_without_a_profile_is_404_and_writes_nothing(client, db, answer):
    db.read.execute.return_value = rows()

    assert client.put(answer_url(), json={"status": "ACCEPTED"}).status_code == 404
    answer.appointment.update.assert_not_called()


@pytest.mark.parametrize(
    ("url", "body"),
    [
        (answer_url(), {"status": "PENDING"}),
        (answer_url(), {"status": "CANCELLED"}),
        (answer_url(), {}),
        (answer_url("not-a-booking"), {"status": "ACCEPTED"}),
    ],
    ids=["pending", "cancelled", "no-status", "malformed-id"],
)
def test_bad_answers_are_422_and_never_query(client, db, url, body):
    assert client.put(url, json=body).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "23514", "message": "check constraint"})}, 503),
        ({"return_value": rows({"id": APPOINTMENT_ID})}, 503),
    ],
    ids=["token-rejected", "query-failed", "schema-mismatch"],
)
def test_answer_failures(client, db, answer, outcome, code):
    answer.updated.execute.configure_mock(**outcome)

    assert client.put(answer_url(), json={"status": "ACCEPTED"}).status_code == code


INBOX_URL = "/dashboard/join-requests"
WAITING_CHAIR = "0000000c-0000-4000-8000-000000000004"
REQUEST_COLS = (
    "id, requested_at:started_at, shop:establishment(slug, name), "
    "worker:worker_profile(first_name, last_name, bio, public_email, public_phone)"
)
APPLICANT = {
    "first_name": "Squidward",
    "last_name": "Tentacles",
    "bio": "Clarinet player, reluctant barber.",
    "public_email": "squidward@example.com",
    "public_phone": None,
}


def join_answer_url(chair_id=WAITING_CHAIR):
    return f"{INBOX_URL}/{chair_id}"


def waiting(shop=KRUSTY, chair_id=WAITING_CHAIR, requested_at="2026-10-29T18:00:00Z"):
    """One waiting worker_establishment row as the inbox reads it."""
    return {
        "id": chair_id,
        "requested_at": requested_at,
        "shop": {"slug": shop["slug"], "name": shop["name"]},
        "worker": APPLICANT,
    }


@pytest.fixture
def inbox(db):
    """
    The caller owns Krusty Fadez. Also the waiting chairs listed there, the guarded
    write each answer runs, and the read that explains a write that matched nothing.
    None of those match anything unless a test fills them.
    """
    owners = db.tables["establishment_owner"]
    owned = owners.select.return_value.eq.return_value
    owned.execute.return_value = rows({"establishment_id": KRUSTY["id"]})
    chairs = db.tables["worker_establishment"]

    def guarded(write):
        return write.return_value.eq.return_value.in_.return_value.eq.return_value.is_.return_value

    listed = chairs.select.return_value.in_.return_value.eq.return_value.is_.return_value.order
    accept, decline = guarded(chairs.update), guarded(chairs.delete)
    reread = chairs.select.return_value.eq.return_value.in_.return_value.limit.return_value
    for query in (listed.return_value, accept.select.return_value, decline.select.return_value):
        query.execute.return_value = rows()
    reread.execute.return_value = rows()
    return SimpleNamespace(
        owners=owners,
        owned=owned,
        chairs=chairs,
        listed=listed,
        accept=accept,
        decline=decline,
        reread=reread,
    )


def test_inbox_lists_the_requests_waiting_at_the_callers_shops(client, db, inbox):
    later = waiting(chair_id=NEW_CHAIR, requested_at="2026-10-30T09:00:00Z")
    inbox.listed.return_value.execute.return_value = rows(waiting(), later)

    response = client.get(INBOX_URL)

    assert response.status_code == 200
    assert response.json() == [waiting(), later]
    options = db.factory.call_args.kwargs["options"]
    assert options.headers["Authorization"] == "Bearer access-1"
    assert inbox.owners.select.call_args == call("establishment_id")
    assert inbox.owners.select.return_value.eq.call_args == call("user_id", CALLER.user_id)
    by_shop = inbox.chairs.select.return_value.in_
    assert inbox.chairs.select.call_args == call(REQUEST_COLS)
    assert by_shop.call_args == call("establishment_id", [KRUSTY["id"]])
    assert by_shop.return_value.eq.call_args == call("is_active", False)
    assert by_shop.return_value.eq.return_value.is_.call_args == call("ended_at", None)
    assert inbox.listed.call_args == call("started_at")


def test_inbox_sends_only_what_a_request_shows(client, db, inbox):
    row = waiting()
    row |= {"worker_id": WORKER_ID, "worker": APPLICANT | {"user_id": CALLER.user_id}}
    inbox.listed.return_value.execute.return_value = rows(row)

    response = client.get(INBOX_URL)

    assert response.status_code == 200
    assert response.json() == [waiting()]


def test_inbox_for_a_caller_who_owns_no_shop_is_empty(client, db, inbox):
    inbox.owned.execute.return_value = rows()

    response = client.get(INBOX_URL)

    assert response.status_code == 200
    assert response.json() == []
    inbox.chairs.select.assert_not_called()


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, 503),
        ({"return_value": rows(waiting() | {"worker": None})}, 503),
    ],
    ids=["token-rejected", "query-failed", "applicant-hidden"],
)
def test_inbox_failures(client, db, inbox, outcome, code):
    inbox.listed.return_value.execute.configure_mock(**outcome)

    assert client.get(INBOX_URL).status_code == code


def assert_guarded(write):
    """The write only touches the waiting chair, and only at the caller's shops."""
    by_id = write.return_value.eq
    by_shop = by_id.return_value.in_
    assert by_id.call_args == call("id", WAITING_CHAIR)
    assert by_shop.call_args == call("establishment_id", [KRUSTY["id"]])
    assert by_shop.return_value.eq.call_args == call("is_active", False)
    assert by_shop.return_value.eq.return_value.is_.call_args == call("ended_at", None)


def test_accepting_gives_the_worker_the_chair_from_now(db, inbox):
    inbox.accept.select.return_value.execute.return_value = rows({"id": WAITING_CHAIR})

    answered = answer_join_request(CALLER, UUID(WAITING_CHAIR), Answer.ACCEPTED, now_utc=NOW)

    assert answered.model_dump(mode="json") == {"id": WAITING_CHAIR, "status": "ACCEPTED"}
    assert inbox.chairs.update.call_args == call(
        {"is_active": True, "started_at": "2026-10-30T13:00:00+00:00"}
    )
    assert_guarded(inbox.chairs.update)
    assert inbox.accept.select.call_args == call("id")
    inbox.chairs.delete.assert_not_called()
    inbox.chairs.select.assert_not_called()


def test_declining_deletes_the_waiting_request(db, inbox):
    inbox.decline.select.return_value.execute.return_value = rows({"id": WAITING_CHAIR})

    answered = answer_join_request(CALLER, UUID(WAITING_CHAIR), Answer.REJECTED, now_utc=NOW)

    assert answered.model_dump(mode="json") == {"id": WAITING_CHAIR, "status": "REJECTED"}
    inbox.chairs.delete.assert_called_once_with()
    assert_guarded(inbox.chairs.delete)
    inbox.chairs.update.assert_not_called()
    inbox.chairs.select.assert_not_called()


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED"])
def test_join_answer_sends_the_chair_and_its_answer(client, db, inbox, status):
    write = inbox.accept if status == "ACCEPTED" else inbox.decline
    write.select.return_value.execute.return_value = rows({"id": WAITING_CHAIR})

    response = client.put(join_answer_url(), json={"status": status})

    assert response.status_code == 200
    assert response.json() == {"id": WAITING_CHAIR, "status": status}


@pytest.mark.parametrize(
    ("state", "asked", "code"),
    [
        ({"is_active": True, "ended_at": None}, "ACCEPTED", 200),
        ({"is_active": True, "ended_at": None}, "REJECTED", 409),
        ({"is_active": False, "ended_at": "2026-10-01T00:00:00+00:00"}, "ACCEPTED", 409),
        ({"is_active": False, "ended_at": "2026-10-01T00:00:00+00:00"}, "REJECTED", 409),
    ],
    ids=["accepted-again", "decline-after-accept", "accept-after-end", "decline-after-end"],
)
def test_answering_a_request_that_isnt_waiting_anymore(client, db, inbox, state, asked, code):
    inbox.reread.execute.return_value = rows(state)

    response = client.put(join_answer_url(), json={"status": asked})

    assert response.status_code == code
    by_id = inbox.chairs.select.return_value.eq
    assert inbox.chairs.select.call_args == call("is_active, ended_at")
    assert by_id.call_args == call("id", WAITING_CHAIR)
    assert by_id.return_value.in_.call_args == call("establishment_id", [KRUSTY["id"]])


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED"])
def test_answer_for_a_request_not_at_the_callers_shops_is_404(client, db, inbox, status):
    assert client.put(join_answer_url(), json={"status": status}).status_code == 404


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED"])
def test_a_caller_who_owns_no_shop_cant_answer_and_writes_nothing(client, db, inbox, status):
    inbox.owned.execute.return_value = rows()

    assert client.put(join_answer_url(), json={"status": status}).status_code == 404
    inbox.chairs.update.assert_not_called()
    inbox.chairs.delete.assert_not_called()


@pytest.mark.parametrize(
    ("url", "body"),
    [
        (join_answer_url(), {"status": "PENDING"}),
        (join_answer_url(), {"status": "CANCELLED"}),
        (join_answer_url(), {}),
        (join_answer_url("not-a-chair"), {"status": "ACCEPTED"}),
    ],
    ids=["pending", "cancelled", "no-status", "malformed-id"],
)
def test_bad_join_answers_are_422_and_never_query(client, db, url, body):
    assert client.put(url, json=body).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("query", "outcome", "code"),
    [
        ("write", {"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ("write", {"side_effect": APIError({"code": "42501", "message": "row-level"})}, 503),
        ("owned", {"return_value": rows({"establishment_id": "not-a-shop"})}, 503),
        ("reread", {"return_value": rows({"is_active": "maybe"})}, 503),
    ],
    ids=["token-rejected", "query-failed", "owner-schema-mismatch", "chair-schema-mismatch"],
)
def test_join_answer_failures(client, db, inbox, query, outcome, code):
    target = {
        "write": inbox.accept.select.return_value,
        "owned": inbox.owned,
        "reread": inbox.reread,
    }[query]
    target.execute.configure_mock(**outcome)

    assert client.put(join_answer_url(), json={"status": "ACCEPTED"}).status_code == code


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
    services.upsert.assert_called_once_with(
        [SKIN_FADE | {"worker_id": WORKER_ID}], on_conflict="id", returning=ReturnMethod.minimal
    )
    services.update.assert_not_called()


def test_a_posted_worker_or_status_is_ignored(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE))
    forged = {"worker_id": "00000003-0000-4000-8000-000000000099", "is_active": False}

    client.put(SERVICES_URL, json={"services": [SKIN_FADE | forged, KIDS_CUT | forged]})

    services.upsert.assert_called_once_with(
        [SKIN_FADE | {"worker_id": WORKER_ID}], on_conflict="id", returning=ReturnMethod.minimal
    )
    services.insert.assert_called_once_with(
        [KIDS_CUT | {"worker_id": WORKER_ID}], returning=ReturnMethod.minimal
    )


@pytest.mark.parametrize(
    ("method", "body"),
    [("GET", None), ("PUT", {"services": [SKIN_FADE]})],
    ids=["read", "save"],
)
def test_the_menu_runs_as_the_caller_on_the_public_key(client, db, services, method, body):
    services.read.execute.return_value = rows(menu(SKIN_FADE))

    client.request(method, SERVICES_URL, json=body)

    assert db.factory.call_args.args[1] == "test-publishable"
    options = db.factory.call_args.kwargs["options"]
    assert options.headers["Authorization"] == "Bearer access-1"


def test_an_unchanged_menu_only_updates(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE))

    client.put(SERVICES_URL, json={"services": [SKIN_FADE]})

    services.upsert.assert_called_once()
    services.update.assert_not_called()
    services.insert.assert_not_called()


def test_a_first_menu_only_adds(client, db, services):
    services.read.execute.return_value = rows(menu())

    client.put(SERVICES_URL, json={"services": [KIDS_CUT]})

    services.insert.assert_called_once()
    services.update.assert_not_called()
    services.upsert.assert_not_called()


@pytest.mark.parametrize(
    "limit",
    [
        {"price_cents": 0},
        {"price_cents": 10_000_000},
        {"duration_min": 1},
        {"duration_min": 1440},
        {"buffer_after_min": 480},
        {"description": ""},
    ],
    ids=["free", "top-price", "shortest", "longest", "top-buffer", "no-description"],
)
def test_a_service_at_the_limits_is_saved(client, db, services, limit):
    services.read.execute.return_value = rows(menu())

    response = client.put(SERVICES_URL, json={"services": [KIDS_CUT | limit]})

    assert response.status_code == 200
    services.insert.assert_called_once_with(
        [KIDS_CUT | limit | {"worker_id": WORKER_ID}], returning=ReturnMethod.minimal
    )


def test_fifty_services_is_the_most_a_menu_takes(client, db, services):
    services.read.execute.return_value = rows(menu())

    response = client.put(SERVICES_URL, json={"services": [KIDS_CUT] * 50})

    assert response.status_code == 200
    assert len(services.insert.call_args.args[0]) == 50


def test_saving_the_menu_caps_the_text(client, db, services):
    services.read.execute.return_value = rows(menu())
    long = KIDS_CUT | {"title": "a" * 101, "description": "b" * 1001}

    client.put(SERVICES_URL, json={"services": [long]})

    sent = services.insert.call_args.args[0][0]
    assert (len(sent["title"]), len(sent["description"])) == (100, 1000)


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
        [SKIN_FADE | {"buffer_after_min": -1}],
        [SKIN_FADE | {"price_cents": 10_000_001}],
        [SKIN_FADE | {"price_cents": 35.5}],
        [SKIN_FADE | {"price_cents": None}],
        [SKIN_FADE | {"duration_min": None}],
        [SKIN_FADE | {"id": "not-a-uuid"}],
        [{"price_cents": 3500, "duration_min": 45}],
    ],
    ids=[
        "repeated-id",
        "empty",
        "too-many",
        "negative-price",
        "no-duration",
        "too-long",
        "big-buffer",
        "negative-buffer",
        "too-expensive",
        "fraction-of-a-cent",
        "price-that-didnt-parse",
        "length-that-didnt-parse",
        "malformed-id",
        "no-title",
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


@pytest.mark.parametrize(
    ("read", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "row-level security"})}, 503),
        ({"return_value": rows({"id": WORKER_ID})}, 503),
    ],
    ids=["token-rejected", "read-refused", "schema-mismatch"],
)
def test_reading_the_menu_failures(client, db, services, read, code):
    services.read.execute.configure_mock(**read)

    assert client.get(SERVICES_URL).status_code == code


WRITE_REFUSED = APIError({"code": "42501", "message": "row-level security"})


def test_a_refused_turn_off_stops_before_any_other_write(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE, BEARD_TRIM))
    turn_off = services.update.return_value.eq.return_value.in_.return_value
    turn_off.execute.side_effect = WRITE_REFUSED

    response = client.put(SERVICES_URL, json={"services": [SKIN_FADE, KIDS_CUT]})

    assert response.status_code == 503
    services.upsert.assert_not_called()
    services.insert.assert_not_called()


def test_a_refused_update_stops_before_anything_is_added(client, db, services):
    services.read.execute.return_value = rows(menu(SKIN_FADE))
    services.upsert.return_value.execute.side_effect = WRITE_REFUSED

    response = client.put(SERVICES_URL, json={"services": [SKIN_FADE, KIDS_CUT]})

    assert response.status_code == 503
    services.insert.assert_not_called()


def tables_used(db):
    """Every table the request's client queried."""
    return {c.args[0] for c in db.factory.return_value.table.call_args_list}


def test_editing_and_deleting_services_only_writes_the_menu(client, db, services):
    edited = SKIN_FADE | {"title": "Zero fade", "price_cents": 9900, "duration_min": 90}
    services.read.execute.return_value = rows(menu(SKIN_FADE, BEARD_TRIM))

    response = client.put(SERVICES_URL, json={"services": [edited]})

    assert response.status_code == 200
    assert tables_used(db) == {"worker_profile", "service"}
    db.tables["service"].delete.assert_not_called()


def test_week_shows_what_was_quoted_without_reading_the_menu(db, week):
    quoted = {"service_title": "Retired cut", "price_cents": 1500, "duration_min": 30}
    week.bookings.execute.return_value = rows(booking(at_krusty(MON_2, "09:00"), **quoted))

    listed = week_at_krusty(db, MONDAY).days[2].appointments[0]

    assert (listed.service_title, listed.price_cents, listed.duration_min) == (
        "Retired cut",
        1500,
        30,
    )
    assert week.appointment.select.call_args == call(ROW_COLS)
    assert "service" not in tables_used(db)


@pytest.mark.parametrize("reply", [Answer.ACCEPTED, Answer.REJECTED], ids=["accept", "reject"])
def test_a_booking_can_be_answered_after_its_service_is_gone(db, answer, reply):
    answer.updated.execute.return_value = rows(
        booking(at_krusty(MON_2, "09:00"), reply.value, service_title="Retired cut")
    )

    found = answer_request(CALLER, UUID(APPOINTMENT_ID), reply, now_utc=NOW)

    assert found.service_title == "Retired cut"
    assert "service" not in tables_used(db)


TIME_OFF_URL = "/dashboard/time-off"
STRETCH_IDS = [f"00000009-0000-4000-8000-00000000000{i}" for i in range(1, 4)]
SUN_1 = date(2026, 11, 1)
THU_5 = date(2026, 11, 5)
KRUSTY_SHOP = {"slug": KRUSTY["slug"], "name": KRUSTY["name"], "timezone": KRUSTY["timezone"]}
BOOKED_COLS = (
    "id, starts_at, duration_min, client_name, service_title, status, "
    "shop:establishment(slug, name, timezone), block_ends_at"
)


def time_off_url(chair_id=CHAIR_IDS[KRUSTY["id"]]):
    return f"{TIME_OFF_URL}?chair={chair_id}"


def stretch(first, last, id=STRETCH_IDS[0]):
    """One worker_time_off row covering these days on Krusty Fadez's calendar."""
    return {
        "id": id,
        "starts": at_krusty(first, "00:00"),
        "ends": at_krusty(last + timedelta(days=1), "00:00"),
    }


def in_time_off(starts_at, block_ends_at, status="ACCEPTED", **row):
    """One booking row as the time off check reads it."""
    return {
        "id": APPOINTMENT_ID,
        "starts_at": starts_at,
        "duration_min": 45,
        "client_name": "Pearl Krabs",
        "service_title": "The Bubble Fade",
        "status": status,
        "shop": KRUSTY_SHOP,
        "block_ends_at": block_ends_at,
    } | row


def krusty_midnight(day):
    return at_krusty(day, "00:00")


@pytest.fixture
def time_off(db):
    """
    The caller's chair at Krusty Fadez, the time off and bookings reads, both
    empty unless a test fills them, and the three time off writes.
    """
    db.read.execute.return_value = rows(mine(chair(KRUSTY, is_active=True)))
    table = db.tables["worker_time_off"]
    appointment = db.tables["appointment"]
    upcoming = table.select.return_value.eq.return_value.gt.return_value.order.return_value
    booked = appointment.select.return_value.eq.return_value.in_.return_value
    booked = booked.lt.return_value.gt.return_value.order.return_value
    upcoming.execute.return_value = rows()
    booked.execute.return_value = rows()
    return SimpleNamespace(
        table=table,
        appointment=appointment,
        upcoming=upcoming,
        booked=booked,
        delete=table.delete,
        upsert=table.upsert,
        insert=table.insert,
    )


def time_off_at_krusty():
    return get_time_off(CALLER, UUID(CHAIR_IDS[KRUSTY["id"]]), now_utc=NOW)


def save_at_krusty(*stretches):
    return save_time_off(CALLER, UUID(CHAIR_IDS[KRUSTY["id"]]), list(stretches), now_utc=NOW)


def test_time_off_lists_whole_days_on_the_shops_calendar(db, time_off):
    time_off.upcoming.execute.return_value = rows(stretch(MON_2, TUE_3))
    time_off.booked.execute.return_value = rows(
        in_time_off(at_krusty(MON_2, "09:00"), at_krusty(MON_2, "09:55"))
    )

    found = time_off_at_krusty()

    assert found.timezone == "Pacific/Kwajalein"
    assert found.today == SAT_31
    assert [(s.first_day, s.last_day, s.bookings) for s in found.stretches] == [(MON_2, TUE_3, 1)]
    assert [(c.client_name, c.shop.name) for c in found.conflicts] == [
        ("Pearl Krabs", "Krusty Fadez")
    ]


def test_time_off_reads_the_callers_stretches_then_their_bookings_in_them(db, time_off):
    time_off.upcoming.execute.return_value = rows(
        stretch(MON_2, MON_2), stretch(THU_5, THU_5, id=STRETCH_IDS[1])
    )

    time_off_at_krusty()

    assert time_off.table.select.call_args == call("id, starts, ends")
    by_worker = time_off.table.select.return_value.eq
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert by_worker.return_value.gt.call_args == call("ends", NOW.isoformat())
    assert by_worker.return_value.gt.return_value.order.call_args == call("starts")
    assert time_off.appointment.select.call_args == call(BOOKED_COLS)
    by_worker = time_off.appointment.select.return_value.eq
    holding = by_worker.return_value.in_
    before = holding.return_value.lt
    after = before.return_value.gt
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert holding.call_args == call("status", ["PENDING", "ACCEPTED"])
    assert before.call_args == call("starts_at", krusty_midnight(THU_5 + timedelta(days=1)))
    assert after.call_args == call("block_ends_at", krusty_midnight(MON_2))
    assert after.return_value.order.call_args == call("starts_at")


def test_time_off_under_way_checks_only_bookings_not_over_yet(db, time_off):
    time_off.upcoming.execute.return_value = rows(stretch(date(2026, 10, 30), MON_2))

    found = time_off_at_krusty()

    assert (found.stretches[0].first_day, found.stretches[0].last_day) == (
        date(2026, 10, 30),
        MON_2,
    )
    after = time_off.appointment.select.return_value.eq.return_value.in_.return_value.lt
    assert after.return_value.gt.call_args == call("block_ends_at", NOW.isoformat())


def test_no_time_off_reads_no_bookings(db, time_off):
    found = time_off_at_krusty()

    assert (found.stretches, found.conflicts) == ([], [])
    time_off.appointment.select.assert_not_called()


@pytest.mark.parametrize(
    ("starts_at", "block_ends_at", "counted"),
    [
        (at_krusty(SUN_1, "23:15"), at_krusty(MON_2, "00:10"), True),
        (at_krusty(SUN_1, "23:15"), at_krusty(MON_2, "00:00"), False),
        (at_krusty(MON_2, "23:30"), at_krusty(TUE_3, "00:30"), True),
        (at_krusty(TUE_3, "00:00"), at_krusty(TUE_3, "00:45"), False),
    ],
    ids=["buffer-runs-in", "ends-as-it-starts", "runs-past-the-end", "starts-as-it-ends"],
)
def test_a_booking_counts_when_it_or_its_buffer_overlaps(
    db, time_off, starts_at, block_ends_at, counted
):
    time_off.upcoming.execute.return_value = rows(stretch(MON_2, MON_2))
    time_off.booked.execute.return_value = rows(in_time_off(starts_at, block_ends_at))

    found = time_off_at_krusty()

    assert found.stretches[0].bookings == int(counted)
    assert len(found.conflicts) == int(counted)


def test_a_booking_between_two_stretches_isnt_listed(db, time_off):
    time_off.upcoming.execute.return_value = rows(
        stretch(MON_2, MON_2), stretch(THU_5, THU_5, id=STRETCH_IDS[1])
    )
    time_off.booked.execute.return_value = rows(
        in_time_off(at_krusty(TUE_3, "10:00"), at_krusty(TUE_3, "10:45"))
    )

    found = time_off_at_krusty()

    assert [s.bookings for s in found.stretches] == [0, 0]
    assert found.conflicts == []


def test_time_off_sends_only_what_a_booking_shows(client, db, time_off):
    time_off.upcoming.execute.return_value = rows(stretch(MON_2, TUE_3))
    time_off.booked.execute.return_value = rows(
        in_time_off(at_krusty(MON_2, "09:00"), at_krusty(MON_2, "09:55"))
    )

    response = client.get(time_off_url())

    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "Pacific/Kwajalein"
    assert body["stretches"] == [
        {"id": STRETCH_IDS[0], "first_day": "2026-11-02", "last_day": "2026-11-03", "bookings": 1}
    ]
    [listed] = body["conflicts"]
    assert set(listed) == {
        "id",
        "starts_at",
        "duration_min",
        "client_name",
        "service_title",
        "status",
        "shop",
    }
    assert listed["shop"] == KRUSTY_SHOP


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize(
    ("held", "chair_id"),
    [
        (mine(chair(KRUSTY, is_active=True)), NEW_CHAIR),
        (mine(chair(KRUSTY, ended_at="2025-06-01T00:00:00+00:00")), CHAIR_IDS[KRUSTY["id"]]),
        (None, CHAIR_IDS[KRUSTY["id"]]),
    ],
    ids=["someone-elses-chair", "ended-chair", "no-profile"],
)
def test_time_off_at_a_chair_the_caller_doesnt_hold_is_404(
    client, db, time_off, held, chair_id, method
):
    db.read.execute.return_value = rows() if held is None else rows(held)
    body = {"stretches": [{"first_day": "2026-11-02", "last_day": "2026-11-02"}]}

    response = client.request(
        method, time_off_url(chair_id), json=body if method == "PUT" else None
    )

    assert response.status_code == 404
    time_off.table.select.assert_not_called()
    time_off.insert.assert_not_called()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize(
    "url", [f"{TIME_OFF_URL}?chair=chair-1", TIME_OFF_URL], ids=["malformed-chair", "no-chair"]
)
def test_time_off_needs_a_well_formed_chair(client, db, url, method):
    response = client.request(method, url, json={"stretches": []} if method == "PUT" else None)

    assert response.status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, 401),
        ({"side_effect": APIError({"code": "42501", "message": "permission denied"})}, 503),
        ({"return_value": rows({"id": STRETCH_IDS[0]})}, 503),
    ],
    ids=["token-rejected", "query-failed", "schema-mismatch"],
)
def test_time_off_failures(client, db, time_off, outcome, code):
    time_off.upcoming.execute.configure_mock(**outcome)

    assert client.get(time_off_url()).status_code == code


def test_new_time_off_runs_from_midnight_to_midnight_on_the_shops_clock(client, db, time_off):
    db.read.execute.return_value = rows(mine(chair(REGULAR, is_active=True)))

    response = client.put(
        time_off_url(CHAIR_IDS[REGULAR["id"]]),
        json={"stretches": [{"first_day": "2026-10-31", "last_day": "2026-11-01"}]},
    )

    assert response.status_code == 200
    # Los Angeles turns its clocks back on November 1, so the two days run 49 hours.
    time_off.insert.assert_called_once_with(
        [
            {
                "worker_id": WORKER_ID,
                "starts": "2026-10-31T07:00:00+00:00",
                "ends": "2026-11-02T08:00:00+00:00",
            }
        ],
        returning=ReturnMethod.minimal,
    )
    time_off.delete.assert_not_called()
    time_off.upsert.assert_not_called()


def test_saving_time_off_removes_changes_and_adds(db, time_off):
    time_off.upcoming.execute.side_effect = [
        rows(
            stretch(MON_2, MON_2),
            stretch(THU_5, THU_5, id=STRETCH_IDS[1]),
            stretch(TUE_3, TUE_3, id=STRETCH_IDS[2]),
        ),
        rows(),
    ]
    nov_20 = date(2026, 11, 20)

    save_at_krusty(
        SaveStretch(id=STRETCH_IDS[0], first_day=MON_2, last_day=MON_2),
        SaveStretch(id=STRETCH_IDS[1], first_day=THU_5, last_day=THU_5 + timedelta(days=1)),
        SaveStretch(first_day=nov_20, last_day=nov_20),
    )

    time_off.delete.assert_called_once_with(returning=ReturnMethod.minimal)
    by_worker = time_off.delete.return_value.eq
    assert by_worker.call_args == call("worker_id", WORKER_ID)
    assert by_worker.return_value.in_.call_args == call("id", [STRETCH_IDS[2]])
    time_off.upsert.assert_called_once_with(
        [
            {
                "id": STRETCH_IDS[1],
                "worker_id": WORKER_ID,
                "starts": krusty_midnight(THU_5),
                "ends": krusty_midnight(THU_5 + timedelta(days=2)),
            }
        ],
        on_conflict="id",
        returning=ReturnMethod.minimal,
    )
    time_off.insert.assert_called_once_with(
        [
            {
                "worker_id": WORKER_ID,
                "starts": krusty_midnight(nov_20),
                "ends": krusty_midnight(nov_20 + timedelta(days=1)),
            }
        ],
        returning=ReturnMethod.minimal,
    )


@pytest.mark.parametrize(
    ("saved", "last_day"),
    [
        (stretch(MON_2, TUE_3), TUE_3),
        (
            {
                "id": STRETCH_IDS[0],
                "starts": at_krusty(MON_2, "10:00"),
                "ends": at_krusty(MON_2, "12:00"),
            },
            MON_2,
        ),
    ],
    ids=["whole-days", "part-of-a-day"],
)
def test_time_off_whose_days_didnt_change_isnt_rewritten(db, time_off, saved, last_day):
    time_off.upcoming.execute.return_value = rows(saved)

    save_at_krusty(SaveStretch(id=STRETCH_IDS[0], first_day=MON_2, last_day=last_day))

    time_off.delete.assert_not_called()
    time_off.upsert.assert_not_called()
    time_off.insert.assert_not_called()


def test_a_new_stretch_that_repeats_another_is_skipped(db, time_off):
    time_off.upcoming.execute.return_value = rows(stretch(MON_2, MON_2))

    save_at_krusty(
        SaveStretch(id=STRETCH_IDS[0], first_day=MON_2, last_day=MON_2),
        SaveStretch(first_day=MON_2, last_day=MON_2),
        SaveStretch(first_day=THU_5, last_day=THU_5),
        SaveStretch(first_day=THU_5, last_day=THU_5),
    )

    time_off.insert.assert_called_once_with(
        [
            {
                "worker_id": WORKER_ID,
                "starts": krusty_midnight(THU_5),
                "ends": krusty_midnight(THU_5 + timedelta(days=1)),
            }
        ],
        returning=ReturnMethod.minimal,
    )


def test_saving_no_time_off_removes_all_still_to_come(client, db, time_off):
    time_off.upcoming.execute.return_value = rows(
        stretch(MON_2, MON_2), stretch(THU_5, THU_5, id=STRETCH_IDS[1])
    )

    assert client.put(time_off_url(), json={"stretches": []}).status_code == 200
    removed = time_off.delete.return_value.eq.return_value.in_
    assert removed.call_args == call("id", STRETCH_IDS[:2])
    time_off.insert.assert_not_called()


def test_time_off_over_bookings_is_saved_and_comes_back_with_them(client, db, time_off):
    time_off.upcoming.execute.side_effect = [rows(), rows(stretch(MON_2, MON_2))]
    time_off.booked.execute.return_value = rows(
        in_time_off(at_krusty(MON_2, "09:00"), at_krusty(MON_2, "09:55"), "PENDING")
    )

    response = client.put(
        time_off_url(), json={"stretches": [{"first_day": "2026-11-02", "last_day": "2026-11-02"}]}
    )

    assert response.status_code == 200
    time_off.insert.assert_called_once()
    body = response.json()
    assert body["stretches"] == [
        {"id": STRETCH_IDS[0], "first_day": "2026-11-02", "last_day": "2026-11-02", "bookings": 1}
    ]
    assert [(c["client_name"], c["status"]) for c in body["conflicts"]] == [
        ("Pearl Krabs", "PENDING")
    ]


@pytest.mark.parametrize(
    "posted",
    [
        [{"first_day": "2026-11-03", "last_day": "2026-11-02"}],
        [{"id": STRETCH_IDS[0], "first_day": "2026-11-02", "last_day": "2026-11-02"}] * 2,
        [{"first_day": "2026-11-02", "last_day": "2026-11-02"}] * 51,
        [{"first_day": "1999-12-31", "last_day": "2026-11-02"}],
        [{"first_day": "2026-11-02", "last_day": "9999-12-31"}],
        [{"first_day": "2026-11-02"}],
    ],
    ids=["ends-before-it-starts", "repeated-id", "too-many", "too-early", "too-late", "no-end"],
)
def test_bad_time_off_is_422_and_never_queries(client, db, posted):
    assert client.put(time_off_url(), json={"stretches": posted}).status_code == 422
    db.factory.assert_not_called()


@pytest.mark.parametrize(
    ("read", "insert", "code"),
    [
        ({"side_effect": APIError({"code": "PGRST303", "message": "JWT expired"})}, {}, 401),
        ({}, {"side_effect": APIError({"code": "42501", "message": "row-level security"})}, 503),
    ],
    ids=["token-rejected", "insert-refused"],
)
def test_saving_time_off_failures(client, db, time_off, read, insert, code):
    time_off.upcoming.execute.configure_mock(**read)
    time_off.insert.return_value.execute.configure_mock(**insert)

    response = client.put(
        time_off_url(), json={"stretches": [{"first_day": "2026-11-02", "last_day": "2026-11-02"}]}
    )

    assert response.status_code == code
