"""
Routes behind the search page. Each tab (shops, workers, location) gets a
blanket list and a search by text; models/search.py has what each returns.
"""

from fastapi import APIRouter, HTTPException, status

from server.models.search import SearchResultShop, SearchResultWorker
from server.supabase.search import (
    DatabaseUnavailable,
    get_all_by_location,
    get_all_shops,
    get_all_workers,
)

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/shops", response_model=list[SearchResultShop])
def all_shops():
    """
    Returns:
        - Every active shop, A to Z by name. An empty list when there are none.
    """
    try:
        return get_all_shops()
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get("/workers", response_model=list[SearchResultWorker])
def all_workers():
    """
    Returns:
        - Every live worker with a chair at a live shop, A to Z by first then
          last name. An empty list when there are none.
    """
    try:
        return get_all_workers()
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get("/locations", response_model=list[SearchResultShop | SearchResultWorker])
def all_by_location():
    """
    Returns:
        - Every active shop and live worker, A to Z by city, then name. A
          worker with shops in two cities appears once in each. An empty list
          when there are none.
    """
    try:
        return get_all_by_location()
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )
