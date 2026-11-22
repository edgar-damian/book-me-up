"""
GET /search/shops, /search/workers and /search/locations against the real
Supabase project, as the public. test_search.py fakes the database, so it can
only check that the queries ask for active rows. These check that inactive
shops, workers and chairs really are left out, by the filters and RLS together.

Each run makes its own shops and workers, named after a one-off token, and
deletes them afterwards.
"""

from collections.abc import Iterator
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from dotenv import dotenv_values
from supabase import Client, create_client

from server.core.config import ENV_FILE
from server.supabase import search

pytestmark = pytest.mark.live

_KEYS = ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY")


def _insert(db: Client, table: str, rows: list[dict]) -> list[dict]:
    return db.table(table).insert(rows).execute().data


def _delete(db: Client, table: str, ids: list[str]) -> None:
    db.table(table).delete().in_("id", ids).execute()


def _shop(token: str, label: str, is_active: bool) -> dict:
    """An establishment row. Both shops share a city, so a city search finds them together."""
    return {
        "slug": f"{token}-{label}",
        "name": f"{label.title()} Shop {token}",
        "address": "1510 N 13th St",
        "city": f"City {token}",
        "state": "ID",
        "zip": "83702",
        "timezone": "America/Boise",
        "is_active": is_active,
    }


@pytest.fixture(scope="module")
def live() -> Iterator[SimpleNamespace]:
    """
    Two shops and four workers, made for this module and deleted after it.
    Only the open shop and the seated worker should show up in any search.

        open        active shop
        closed      inactive shop
        seated      live worker, active chairs at both shops
        hidden      worker not live yet, active chair at the open shop
        waiting     live worker, chair at the open shop still a join request
        stranded    live worker, only chair is at the closed shop

    Every slug, last name and city carries the token, so a search for it
    reaches all of them and nothing else.
    """
    env = dotenv_values(ENV_FILE)
    missing = [key for key in _KEYS if not env.get(key)]
    if missing:
        pytest.fail(f"server/.env needs {', '.join(missing)} for live tests")

    admin = create_client(env["SUPABASE_URL"], env["SUPABASE_SECRET_KEY"])
    token = f"livetest{uuid4().hex[:12]}"

    # Callbacks run last-registered first, so each profile goes before its user.
    with ExitStack() as cleanup:
        open_shop, closed_shop = _insert(
            admin, "establishment", [_shop(token, "open", True), _shop(token, "closed", False)]
        )
        cleanup.callback(_delete, admin, "establishment", [open_shop["id"], closed_shop["id"]])

        def worker(role: str, is_active: bool, chairs: list[tuple[dict, bool]]) -> str:
            # app_user is filled from auth.users by a trigger, never inserted directly.
            user = admin.auth.admin.create_user(
                {
                    "email": f"{token}-{role}@example.com",
                    "password": uuid4().hex,
                    "email_confirm": True,
                }
            ).user
            cleanup.callback(admin.auth.admin.delete_user, user.id)

            [profile] = _insert(
                admin,
                "worker_profile",
                [
                    {
                        "user_id": user.id,
                        "slug": f"{token}-{role}",
                        "first_name": role.title(),
                        "last_name": token,
                        "is_active": is_active,
                    }
                ],
            )
            cleanup.callback(_delete, admin, "worker_profile", [profile["id"]])

            _insert(
                admin,
                "worker_establishment",
                [
                    {"worker_id": profile["id"], "establishment_id": shop["id"], "is_active": on}
                    for shop, on in chairs
                ],
            )
            return profile["slug"]

        yield SimpleNamespace(
            token=token,
            public=create_client(env["SUPABASE_URL"], env["SUPABASE_PUBLISHABLE_KEY"]),
            open_shop=open_shop["slug"],
            closed_shop=closed_shop["slug"],
            seated=worker("seated", True, [(open_shop, True), (closed_shop, True)]),
            hidden=worker("hidden", False, [(open_shop, True)]),
            waiting=worker("waiting", True, [(open_shop, False)]),
            stranded=worker("stranded", True, [(closed_shop, True)]),
        )


@pytest.fixture(autouse=True)
def as_the_public(live):
    """The search queries go to the real project with the publishable key, so RLS applies."""
    with patch.object(search, "public_db", live.public):
        yield


# Each list, blanket and narrowed to the token: (url, query param or None).
SHOP_LISTS = {
    "shops": ("/search/shops", None),
    "shops-by-name": ("/search/shops", "name"),
    "locations": ("/search/locations", None),
    "locations-by-city": ("/search/locations", "city"),
}
WORKER_LISTS = {
    "workers": ("/search/workers", None),
    "workers-by-name": ("/search/workers", "name"),
    "locations": ("/search/locations", None),
    "locations-by-city": ("/search/locations", "city"),
}


def _cards(client, live, url: str, param: str | None) -> dict[str, dict]:
    """The list's cards by slug."""
    r = client.get(url, params={param: live.token} if param else None)
    assert r.status_code == 200, r.text
    return {card["slug"]: card for card in r.json()}


@pytest.mark.parametrize(("url", "param"), SHOP_LISTS.values(), ids=SHOP_LISTS.keys())
def test_an_inactive_shop_is_left_out(client, live, url, param):
    slugs = _cards(client, live, url, param)

    assert live.open_shop in slugs
    assert live.closed_shop not in slugs


@pytest.mark.parametrize("who", ["hidden", "waiting", "stranded"])
@pytest.mark.parametrize(("url", "param"), WORKER_LISTS.values(), ids=WORKER_LISTS.keys())
def test_a_worker_with_nothing_to_book_is_left_out(client, live, url, param, who):
    slugs = _cards(client, live, url, param)

    assert live.seated in slugs
    assert getattr(live, who) not in slugs


@pytest.mark.parametrize(("url", "param"), WORKER_LISTS.values(), ids=WORKER_LISTS.keys())
def test_a_chair_at_an_inactive_shop_is_left_off_the_card(client, live, url, param):
    card = _cards(client, live, url, param)[live.seated]

    assert [shop["slug"] for shop in card["shops"]] == [live.open_shop]
