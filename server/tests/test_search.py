"""
GET /search/shops, /search/workers and /search/locations through the real
query functions with only public_db faked: what each query asks for, the
order results come back in, and how failures map.
"""

from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

import httpx
import pytest
from postgrest import APIError

from server.models.search import SearchResultShop, SearchResultWorker
from server.supabase import search

SHOPS_URL = "/search/shops"
WORKERS_URL = "/search/workers"
LOCATIONS_URL = "/search/locations"


def _shop(name: str, slug: str, **extra) -> dict:
    """An establishment row shaped the way PostgREST returns the card columns."""
    return {
        "slug": slug,
        "name": name,
        "address": "1510 N 13th St",
        "city": "Boise",
        "state": "ID",
        "zip": "83702",
        "images": [],
        **extra,
    }


@pytest.fixture
def shops():
    """The public_db establishment query. execute.return_value.data holds the rows."""
    with patch.object(search, "public_db") as public_db:
        table = public_db.table
        select = table.return_value.select
        active = select.return_value.eq
        execute = active.return_value.execute
        execute.return_value = MagicMock(data=[])
        yield SimpleNamespace(table=table, select=select, active=active, execute=execute)


def test_shops_come_back_a_to_z_ignoring_case(client, shops):
    shops.execute.return_value.data = [
        _shop("Zebra Cuts", "zebra-cuts"),
        _shop("the fade room", "the-fade-room"),
        _shop("Capitol Cuts", "capitol-cuts"),
    ]

    r = client.get(SHOPS_URL)

    assert r.status_code == 200
    assert [shop["name"] for shop in r.json()] == ["Capitol Cuts", "the fade room", "Zebra Cuts"]


def test_same_name_shops_are_ordered_by_slug(client, shops):
    shops.execute.return_value.data = [
        _shop("Supercuts", "supercuts-fairview"),
        _shop("Supercuts", "supercuts-bench"),
    ]

    slugs = [shop["slug"] for shop in client.get(SHOPS_URL).json()]

    assert slugs == ["supercuts-bench", "supercuts-fairview"]


def test_reads_active_shops_and_only_the_card_columns(client, shops):
    assert client.get(SHOPS_URL).status_code == 200
    assert shops.table.call_args == call("establishment")
    assert shops.active.call_args == call("is_active", True)
    assert set(shops.select.call_args.args[0].split(", ")) == set(SearchResultShop.model_fields)


def test_card_carries_the_row_as_saved(client, shops):
    row = _shop("Capitol Cuts", "capitol-cuts", images=["https://img.test/front.jpg"])
    shops.execute.return_value.data = [row]

    assert client.get(SHOPS_URL).json() == [{**row, "kind": "shop"}]


def test_columns_not_on_the_card_never_leave(client, shops):
    hidden = {
        "id": str(uuid4()),
        "email": "hello@capitolcuts.test",
        "phone": "+12085550100",
        "lat": 43.6,
        "is_active": True,
    }
    shops.execute.return_value.data = [_shop("Capitol Cuts", "capitol-cuts", **hidden)]

    card = client.get(SHOPS_URL).json()[0]

    assert set(card) == set(SearchResultShop.model_fields) | {"kind"}


def test_no_shops_is_an_empty_list(client, shops):
    r = client.get(SHOPS_URL)

    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.parametrize(
    "error",
    [APIError({"code": "42501", "message": "permission denied"}), httpx.ConnectError("down")],
)
def test_database_failure_is_a_vague_503(client, shops, error):
    shops.execute.side_effect = error

    r = client.get(SHOPS_URL)

    assert r.status_code == 503
    assert r.json() == {"detail": "Service temporarily unavailable"}


def test_row_that_no_longer_fits_the_card_is_503(client, shops):
    row = _shop("Capitol Cuts", "capitol-cuts")
    del row["name"]
    shops.execute.return_value.data = [row]

    assert client.get(SHOPS_URL).status_code == 503


def _worker_shop(name: str, slug: str, **extra) -> dict:
    """One entry of a worker's shops: the spread establishment columns."""
    return {"slug": slug, "name": name, "city": "Bikini Bottom", "state": "MH", **extra}


def _worker(first: str, last: str, slug: str, shops: list[dict] | None = None, **extra) -> dict:
    """A worker_profile row shaped the way PostgREST returns the card columns."""
    return {
        "slug": slug,
        "first_name": first,
        "last_name": last,
        "image": None,
        "shops": shops if shops is not None else [_worker_shop("Krusty Fadez", "krusty-fadez")],
        **extra,
    }


@pytest.fixture
def workers():
    """The public_db worker_profile query. execute.return_value.data holds the rows."""
    with patch.object(search, "public_db") as public_db:
        table = public_db.table
        select = table.return_value.select
        live = select.return_value.eq
        seated = live.return_value.eq
        execute = seated.return_value.execute
        execute.return_value = MagicMock(data=[])
        yield SimpleNamespace(table=table, select=select, live=live, seated=seated, execute=execute)


def test_workers_come_back_a_to_z_by_first_name_ignoring_case(client, workers):
    workers.execute.return_value.data = [
        _worker("Sandy", "Cheeks", "sandy-cheeks"),
        _worker("eugene", "Krabs", "eugene-krabs"),
        _worker("Benson", "Dunwoody", "benson-dunwoody"),
    ]

    r = client.get(WORKERS_URL)

    assert r.status_code == 200
    assert [w["first_name"] for w in r.json()] == ["Benson", "eugene", "Sandy"]


def test_same_first_name_is_ordered_by_last_name_ignoring_case(client, workers):
    workers.execute.return_value.data = [
        _worker("Chris", "Young", "chris-fades"),
        _worker("Chris", "lee", "chris-lineups"),
    ]

    last_names = [w["last_name"] for w in client.get(WORKERS_URL).json()]

    assert last_names == ["lee", "Young"]


def test_same_full_name_is_ordered_by_slug(client, workers):
    workers.execute.return_value.data = [
        _worker("Chris", "Lee", "chris-lee-boise"),
        _worker("Chris", "Lee", "chris-lee-austin"),
    ]

    slugs = [w["slug"] for w in client.get(WORKERS_URL).json()]

    assert slugs == ["chris-lee-austin", "chris-lee-boise"]


def test_a_workers_shops_come_back_a_to_z(client, workers):
    two_chairs = [
        _worker_shop("Regular Cutz", "regular-cutz"),
        _worker_shop("Krusty Fadez", "krusty-fadez"),
    ]
    workers.execute.return_value.data = [_worker("Skips", "Yeti", "skips-yeti", shops=two_chairs)]

    shops = client.get(WORKERS_URL).json()[0]["shops"]

    assert [shop["name"] for shop in shops] == ["Krusty Fadez", "Regular Cutz"]


def test_reads_live_workers_with_a_chair_and_only_the_card_columns(client, workers):
    assert client.get(WORKERS_URL).status_code == 200
    assert workers.table.call_args == call("worker_profile")
    assert workers.live.call_args == call("is_active", True)
    assert workers.seated.call_args == call("worker_establishment.is_active", True)
    assert workers.select.call_args.args[0] == (
        "slug, first_name, last_name, image, "
        "shops:worker_establishment!inner(...establishment!inner(slug, name, city, state))"
    )


def test_worker_card_carries_the_row_as_saved(client, workers):
    row = _worker("Sandy", "Cheeks", "sandy-cheeks", image="https://img.test/sandy.jpg")
    workers.execute.return_value.data = [row]

    assert client.get(WORKERS_URL).json() == [{**row, "kind": "worker"}]


def test_worker_columns_not_on_the_card_never_leave(client, workers):
    shop = _worker_shop(
        "Krusty Fadez",
        "krusty-fadez",
        address="831 Bottom Feeder Lane",
        timezone="Pacific/Kwajalein",
    )
    hidden = {
        "id": str(uuid4()),
        "user_id": str(uuid4()),
        "bio": "I am ready!",
        "public_email": "spongebob@krustyfadez.test",
        "public_phone": "+16925550102",
        "auto_accept": True,
    }
    workers.execute.return_value.data = [
        _worker("SpongeBob", "SquarePants", "spongebob-squarepants", shops=[shop], **hidden)
    ]

    card = client.get(WORKERS_URL).json()[0]

    assert set(card) == set(SearchResultWorker.model_fields) | {"kind"}
    assert set(card["shops"][0]) == set(SearchResultWorker.Shop.model_fields)


def test_no_workers_is_an_empty_list(client, workers):
    r = client.get(WORKERS_URL)

    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.parametrize(
    "error",
    [APIError({"code": "42501", "message": "permission denied"}), httpx.ConnectError("down")],
)
def test_worker_database_failure_is_a_vague_503(client, workers, error):
    workers.execute.side_effect = error

    r = client.get(WORKERS_URL)

    assert r.status_code == 503
    assert r.json() == {"detail": "Service temporarily unavailable"}


def test_worker_row_that_no_longer_fits_the_card_is_503(client, workers):
    row = _worker("Patrick", "Star", "patrick-star")
    del row["first_name"]
    workers.execute.return_value.data = [row]

    assert client.get(WORKERS_URL).status_code == 503


def _label(card: dict) -> str:
    """The name a card shows: the shop's, or the worker's first and last."""
    if card["kind"] == "shop":
        return card["name"]
    return f"{card['first_name']} {card['last_name']}"


@pytest.fixture
def places():
    """Both public_db queries, told apart by table. .shops / .workers hold the rows."""
    with patch.object(search, "public_db") as public_db:
        tables = defaultdict(MagicMock)
        public_db.table.side_effect = tables.__getitem__
        shops = tables["establishment"].select.return_value.eq.return_value.execute
        seated = tables["worker_profile"].select.return_value.eq.return_value.eq
        workers = seated.return_value.execute
        shops.return_value = MagicMock(data=[])
        workers.return_value = MagicMock(data=[])
        yield SimpleNamespace(tables=tables, shops=shops, workers=workers)


def test_location_list_is_a_to_z_by_city_then_name(client, places):
    twin_peaks = _worker_shop("Regular Cutz", "regular-cutz", city="Twin Peaks", state="CA")
    places.shops.return_value.data = [
        _shop("Regular Cutz", "regular-cutz", city="Twin Peaks", state="CA"),
        _shop("Krusty Fadez", "krusty-fadez", city="Bikini Bottom", state="MH"),
    ]
    places.workers.return_value.data = [
        _worker("Benson", "Dunwoody", "benson-dunwoody", shops=[twin_peaks]),
        _worker("SpongeBob", "SquarePants", "spongebob-squarepants"),
    ]

    r = client.get(LOCATIONS_URL)

    assert r.status_code == 200
    assert [(card["kind"], _label(card)) for card in r.json()] == [
        ("shop", "Krusty Fadez"),
        ("worker", "SpongeBob SquarePants"),
        ("worker", "Benson Dunwoody"),
        ("shop", "Regular Cutz"),
    ]


def test_location_sorts_city_then_state_ignoring_case(client, places):
    places.shops.return_value.data = [
        _shop("Avenue Cuts", "avenue-cuts", city="Springfield", state="MO"),
        _shop("Corner Cuts", "corner-cuts", city="springfield", state="IL"),
        _shop("Peak Cuts", "peak-cuts", city="Twin Peaks", state="CA"),
        _shop("Zed Cuts", "zed-cuts", city="Boise", state="ID"),
    ]

    names = [_label(card) for card in client.get(LOCATIONS_URL).json()]

    assert names == ["Zed Cuts", "Corner Cuts", "Avenue Cuts", "Peak Cuts"]


def test_place_spelled_in_two_cases_is_one_place(client, places):
    places.shops.return_value.data = [
        _shop("Bench Barber", "bench-barber", city="Boise", state="ID"),
        _shop("Alley Cuts", "alley-cuts", city="boise", state="Id"),
    ]

    names = [_label(card) for card in client.get(LOCATIONS_URL).json()]

    assert names == ["Alley Cuts", "Bench Barber"]


def test_location_names_ignore_case(client, places):
    places.shops.return_value.data = [
        _shop("Zebra Cuts", "zebra-cuts"),
        _shop("the fade room", "the-fade-room"),
        _shop("Capitol Cuts", "capitol-cuts"),
    ]

    names = [_label(card) for card in client.get(LOCATIONS_URL).json()]

    assert names == ["Capitol Cuts", "the fade room", "Zebra Cuts"]


def test_a_workers_name_is_first_then_last(client, places):
    places.shops.return_value.data = [
        _shop("Chris Barber Shop", "chris-barber-shop", city="Bikini Bottom", state="MH"),
    ]
    places.workers.return_value.data = [
        _worker("Chris", "Young", "chris-young"),
        _worker("Ann", "Zimmer", "ann-zimmer"),
        _worker("Chris", "Adams", "chris-adams"),
    ]

    names = [_label(card) for card in client.get(LOCATIONS_URL).json()]

    assert names == ["Ann Zimmer", "Chris Adams", "Chris Barber Shop", "Chris Young"]


def test_location_ties_on_name_go_by_slug(client, places):
    places.shops.return_value.data = [
        _shop("Supercuts", "supercuts-fairview"),
        _shop("Supercuts", "supercuts-bench"),
    ]

    slugs = [card["slug"] for card in client.get(LOCATIONS_URL).json()]

    assert slugs == ["supercuts-bench", "supercuts-fairview"]


def test_worker_in_two_cities_gets_a_card_in_each(client, places):
    two_cities = [
        _worker_shop("Regular Cutz", "regular-cutz", city="Twin Peaks", state="CA"),
        _worker_shop("Krusty Fadez", "krusty-fadez"),
    ]
    places.workers.return_value.data = [_worker("Skips", "Yeti", "skips-yeti", shops=two_cities)]

    cards = client.get(LOCATIONS_URL).json()

    assert [(card["slug"], [shop["name"] for shop in card["shops"]]) for card in cards] == [
        ("skips-yeti", ["Krusty Fadez"]),
        ("skips-yeti", ["Regular Cutz"]),
    ]


def test_worker_with_two_shops_in_one_city_gets_one_card(client, places):
    one_city = [
        _worker_shop("Bench Barber", "bench-barber", city="Boise", state="ID"),
        _worker_shop("Alley Cuts", "alley-cuts", city="Boise", state="Id"),
    ]
    places.workers.return_value.data = [
        _worker("Jenna", "Whitfield", "jenna-whitfield", shops=one_city)
    ]

    cards = client.get(LOCATIONS_URL).json()

    assert [[shop["name"] for shop in card["shops"]] for card in cards] == [
        ["Alley Cuts", "Bench Barber"]
    ]


def test_location_reads_both_lists_the_way_their_tabs_do(client, places):
    assert client.get(LOCATIONS_URL).status_code == 200

    assert set(places.tables) == {"establishment", "worker_profile"}
    shops, workers = places.tables["establishment"], places.tables["worker_profile"]
    assert shops.select.call_args == call(search._SHOP_CARD_COLS)
    assert shops.select.return_value.eq.call_args == call("is_active", True)
    live = workers.select.return_value.eq
    assert workers.select.call_args == call(search._WORKER_CARD_COLS)
    assert live.call_args == call("is_active", True)
    assert live.return_value.eq.call_args == call("worker_establishment.is_active", True)


def test_nothing_live_is_an_empty_location_list(client, places):
    r = client.get(LOCATIONS_URL)

    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.parametrize("failing", ["shops", "workers"])
@pytest.mark.parametrize(
    "error",
    [APIError({"code": "42501", "message": "permission denied"}), httpx.ConnectError("down")],
)
def test_location_database_failure_is_a_vague_503(client, places, failing, error):
    getattr(places, failing).side_effect = error

    r = client.get(LOCATIONS_URL)

    assert r.status_code == 503
    assert r.json() == {"detail": "Service temporarily unavailable"}
