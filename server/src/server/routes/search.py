"""
Routes behind the search page. Each tab (shops, workers, location) is one
route: without search text it returns the blanket list, with it only the
matches. models/search.py has what each returns.
"""

from fastapi import APIRouter, HTTPException, Query, status

from server.models.search import SearchResultShop, SearchResultWorker
from server.supabase.search import (
    BlankSearch,
    DatabaseUnavailable,
    get_all_by_location,
    get_all_shops,
    get_all_workers,
)

router = APIRouter(prefix="/search", tags=["search"])

_BAD_SEARCH = {422: {"description": "Search text that is blank or over 100 characters"}}


@router.get("/shops", response_model=list[SearchResultShop], responses=_BAD_SEARCH)
def all_shops(
    name: str | None = Query(
        None,
        max_length=100,
        description="Only shops whose name contains this, ignoring case",
    ),
):
    """
    Args:
        - name (str | None): typed search text, left off for every shop

    Returns:
        - Active shops A to Z by name, all of them or only the matches. An
          empty list when there are none.
    """
    try:
        return get_all_shops(name)
    except BlankSearch as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get("/workers", response_model=list[SearchResultWorker], responses=_BAD_SEARCH)
def all_workers(
    name: str | None = Query(
        None,
        max_length=100,
        description="Only workers whose first and last name contain this, ignoring case",
    ),
):
    """
    Args:
        - name (str | None): typed search text, left off for every worker

    Returns:
        - Live workers with a chair at a live shop, A to Z by first then last
          name, all of them or only the matches. An empty list when there are
          none.
    """
    try:
        return get_all_workers(name)
    except BlankSearch as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get(
    "/locations",
    response_model=list[SearchResultShop | SearchResultWorker],
    responses=_BAD_SEARCH,
)
def all_by_location(
    city: str | None = Query(
        None,
        max_length=100,
        description="Only shops whose city contains this, and the workers with a shop there",
    ),
):
    """
    Args:
        - city (str | None): typed search text, left off for every place

    Returns:
        - Active shops and live workers, A to Z by city, then name, all of
          them or only the matches. A worker with shops in two cities appears
          once in each. An empty list when there are none.
    """
    try:
        return get_all_by_location(city)
    except BlankSearch as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )
