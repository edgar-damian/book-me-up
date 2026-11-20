"""
Queries behind the search page. All of them read through public_db, so RLS
hides inactive shops and workers on top of the explicit filters here.
"""

import logging

from pydantic import ValidationError

from server.models.search import SearchResultShop, SearchResultWorker
from server.supabase.sb_function import DatabaseUnavailable, _cols, _run, public_db

logger = logging.getLogger(__name__)

_SHOP_CARD_COLS = _cols(SearchResultShop)

_WORKER_SHOP_COLS = _cols(SearchResultWorker.Shop)

# The spread turns each chair into its shop's columns. The outer !inner drops
# workers with no visible chair, the inner one drops chairs at hidden shops.
_WORKER_CARD_COLS = _cols(
    SearchResultWorker,
    shops=f"shops:worker_establishment!inner(...establishment!inner({_WORKER_SHOP_COLS}))",
)


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


def _fetch_shops() -> list[SearchResultShop]:
    """Every active shop, in no particular order."""
    resp = _run(
        public_db.table("establishment").select(_SHOP_CARD_COLS).eq("is_active", True),
        "shop search",
    )

    try:
        return [SearchResultShop.model_validate(row) for row in resp.data]
    except ValidationError as exc:
        logger.exception("establishment rows failed validation for shop search")
        raise DatabaseUnavailable("schema mismatch") from exc


def _fetch_workers() -> list[SearchResultWorker]:
    """
    Every live worker with an active chair at a live shop, in no particular
    order. Each card's shops are A to Z.
    """
    resp = _run(
        public_db.table("worker_profile")
        .select(_WORKER_CARD_COLS)
        .eq("is_active", True)
        .eq("worker_establishment.is_active", True),
        "worker search",
    )

    try:
        workers = [SearchResultWorker.model_validate(row) for row in resp.data]
    except ValidationError as exc:
        logger.exception("worker_profile rows failed validation for worker search")
        raise DatabaseUnavailable("schema mismatch") from exc

    for worker in workers:
        worker.shops.sort(key=_by_name)
    return workers


def get_all_shops() -> list[SearchResultShop]:
    """
    Every active shop for the Shops tab before anything is typed, A to Z by
    name ignoring case. Supabase's max_rows setting (1000 by default) caps
    the list.

    Returns:
        - list[SearchResultShop], empty when no shop is active

    Raises:
        - DatabaseUnavailable: query failure, or a row that no longer matches
          the model.
    """
    return sorted(_fetch_shops(), key=_by_name)


def get_all_workers() -> list[SearchResultWorker]:
    """
    Every live worker for the Workers tab before anything is typed: A to Z by
    first name, then last name, ignoring case, then by slug. Each card's shops
    are A to Z the same way as the shop list.

    A worker with no active chair at a live shop is left out, since their
    page has nothing to book. Supabase's max_rows setting (1000 by default)
    caps the list.

    Returns:
        - list[SearchResultWorker], empty when no worker is live

    Raises:
        - DatabaseUnavailable: query failure, or a row that no longer matches
          the model.
    """
    return sorted(
        _fetch_workers(),
        key=lambda worker: (
            worker.first_name.casefold(),
            worker.last_name.casefold(),
            worker.slug,
        ),
    )


def get_all_by_location() -> list[SearchResultShop | SearchResultWorker]:
    """
    Every active shop and live worker for the Location tab before anything is
    typed: A to Z by city, then state, then name, then slug, ignoring case. A
    worker's name is "first last", so shops and workers in one city interleave.

    A worker with shops in more than one city gets a card in each, listing
    only that city's shops. Cities that differ only in case count as one
    place. Supabase's max_rows setting (1000 by default) caps each query.

    Returns:
        - list[SearchResultShop | SearchResultWorker], empty when nothing is live

    Raises:
        - DatabaseUnavailable: either query failed, or a row no longer matches
          its model.
    """
    cards: list[SearchResultShop | SearchResultWorker] = list(_fetch_shops())

    for worker in _fetch_workers():
        by_place: dict[tuple[str, str], list[SearchResultWorker.Shop]] = {}
        for shop in worker.shops:
            by_place.setdefault((shop.city.casefold(), shop.state.casefold()), []).append(shop)
        cards.extend(worker.model_copy(update={"shops": here}) for here in by_place.values())

    return sorted(cards, key=_location_order)
