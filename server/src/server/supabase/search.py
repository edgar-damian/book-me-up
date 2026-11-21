"""
Queries behind the search page. All of them read through public_db, so RLS
hides inactive shops and workers on top of the explicit filters here.

Typed search text reaches PostgREST only as an ilike value, never inside
.or_(), so it can't change the shape of the filter.
"""

import logging

from pydantic import ValidationError

from server.models.search import SearchResultShop, SearchResultWorker
from server.supabase.booking import _NAME_CAP, _clean
from server.supabase.sb_function import DatabaseUnavailable, _cols, _run, public_db

logger = logging.getLogger(__name__)


class BlankSearch(ValueError):
    """Search text with nothing visible left once tidied. Route turns this into a 422."""


_SHOP_CARD_COLS = _cols(SearchResultShop)

_WORKER_SHOP_COLS = _cols(SearchResultWorker.Shop)

# The spread turns each chair into its shop's columns. The outer !inner drops
# workers with no visible chair, the inner one drops chairs at hidden shops.
_WORKER_CARD_COLS = _cols(
    SearchResultWorker,
    shops=f"shops:worker_establishment!inner(...establishment!inner({_WORKER_SHOP_COLS}))",
)


def _contains(text: str) -> str:
    """
    ILIKE pattern that finds the typed text anywhere, ignoring case. The text
    is tidied the way a saved name is, and backslash, % and _ are escaped so
    they match themselves. * becomes a space, since PostgREST reads it as %.

    Raises:
        - BlankSearch: nothing visible is left, which would match everything.
    """
    term = _clean(text.replace("*", " "), _NAME_CAP)
    if not term:
        raise BlankSearch("Type something to search for")
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _by_name(shop: SearchResultShop | SearchResultWorker.Shop) -> tuple[str, str]:
    """
    Sorted here rather than in Postgres so case doesn't depend on the
    database's collation. Slug settles two shops with the same name.
    """
    return (shop.name.casefold(), shop.slug)


def _location_order(card: SearchResultShop | SearchResultWorker) -> tuple[str, ...]:
    """
    City, state, name, slug, ignoring case. A worker card sits in the city of
    its shops, which get_all_by_location() keeps to one city per card. kind
    only settles a shop and a worker that tie on everything else.
    """
    if isinstance(card, SearchResultShop):
        place, name = card, card.name
    else:
        place, name = card.shops[0], f"{card.first_name} {card.last_name}"
    return (place.city.casefold(), place.state.casefold(), name.casefold(), card.slug, card.kind)


def _fetch_shops(*, name: str | None = None, city: str | None = None) -> list[SearchResultShop]:
    """Every active shop, in no particular order, narrowed by name or city when given."""
    query = public_db.table("establishment").select(_SHOP_CARD_COLS).eq("is_active", True)
    if name is not None:
        query = query.ilike("name", _contains(name))
    if city is not None:
        query = query.ilike("city", _contains(city))
    resp = _run(query, "shop search")

    try:
        return [SearchResultShop.model_validate(row) for row in resp.data]
    except ValidationError as exc:
        logger.exception("establishment rows failed validation for shop search")
        raise DatabaseUnavailable("schema mismatch") from exc


def _fetch_workers(*, name: str | None = None, city: str | None = None) -> list[SearchResultWorker]:
    """
    Every live worker with an active chair at a live shop, in no particular
    order, narrowed by name or city when given. Each card's shops are A to Z.
    """
    query = (
        public_db.table("worker_profile")
        .select(_WORKER_CARD_COLS)
        .eq("is_active", True)
        .eq("worker_establishment.is_active", True)
    )
    if name is not None:
        query = query.ilike("full_name", _contains(name))
    if city is not None:
        # Narrows each worker's shops to that city; the !inner drops workers left with none.
        query = query.ilike("worker_establishment.establishment.city", _contains(city))
    resp = _run(query, "worker search")

    try:
        workers = [SearchResultWorker.model_validate(row) for row in resp.data]
    except ValidationError as exc:
        logger.exception("worker_profile rows failed validation for worker search")
        raise DatabaseUnavailable("schema mismatch") from exc

    for worker in workers:
        worker.shops.sort(key=_by_name)
    return workers


def get_all_shops(name: str | None = None) -> list[SearchResultShop]:
    """
    Active shops for the Shops tab, A to Z by name ignoring case: all of them,
    or only those whose name contains the typed text. Supabase's max_rows
    setting (1000 by default) caps the list.

    Args:
        - name (str | None): typed search text, or None for every shop

    Returns:
        - list[SearchResultShop], empty when nothing matches

    Raises:
        - BlankSearch: name has nothing visible in it. Checked before any
          query runs.
        - DatabaseUnavailable: query failure, or a row that no longer matches
          the model.
    """
    return sorted(_fetch_shops(name=name), key=_by_name)


def get_all_workers(name: str | None = None) -> list[SearchResultWorker]:
    """
    Live workers for the Workers tab: A to Z by first name, then last name,
    ignoring case, then by slug. All of them, or only those whose "first
    last" contains the typed text. Each card's shops are A to Z the same way
    as the shop list.

    A worker with no active chair at a live shop is left out, since their
    page has nothing to book. Supabase's max_rows setting (1000 by default)
    caps the list.

    Args:
        - name (str | None): typed search text, or None for every worker

    Returns:
        - list[SearchResultWorker], empty when nothing matches

    Raises:
        - BlankSearch: name has nothing visible in it. Checked before any
          query runs.
        - DatabaseUnavailable: query failure, or a row that no longer matches
          the model.
    """
    return sorted(
        _fetch_workers(name=name),
        key=lambda worker: (
            worker.first_name.casefold(),
            worker.last_name.casefold(),
            worker.slug,
        ),
    )


def get_all_by_location(city: str | None = None) -> list[SearchResultShop | SearchResultWorker]:
    """
    Active shops and live workers for the Location tab: A to Z by city, then
    state, then name, then slug, ignoring case. A worker's name is "first
    last", so shops and workers in one city interleave. With city, only the
    shops whose city contains the typed text, and the workers with a shop
    there.

    A worker with shops in more than one city gets a card in each, listing
    only that city's shops. Cities that differ only in case count as one
    place.

    Args:
        - city (str | None): typed search text, or None for every place

    Returns:
        - list[SearchResultShop | SearchResultWorker], empty when nothing matches

    Raises:
        - BlankSearch: city has nothing visible in it. Checked before any
          query runs.
        - DatabaseUnavailable: either query failed, or a row no longer matches
          its model.
    """
    cards: list[SearchResultShop | SearchResultWorker] = list(_fetch_shops(city=city))

    for worker in _fetch_workers(city=city):
        by_place: dict[tuple[str, str], list[SearchResultWorker.Shop]] = {}
        for shop in worker.shops:
            by_place.setdefault((shop.city.casefold(), shop.state.casefold()), []).append(shop)
        cards.extend(worker.model_copy(update={"shops": here}) for here in by_place.values())

    return sorted(cards, key=_location_order)
