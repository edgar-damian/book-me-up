from fastapi import APIRouter, HTTPException, Path, status

from server.models.schemas import BarberPublic
from server.supabase.sb_function import DatabaseUnavailable, get_barber_by_slug

router = APIRouter()


@router.get("/health")
def health():
    """Liveness probe. Deliberately does not touch the database."""
    return {"status": "ok"}


@router.get(
    "/book-with/{barber_slug}",
    response_model=BarberPublic,
    responses={404: {"description": "No active barber with that slug"}},
)
def book_with(
    barber_slug: str = Path(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="lowercase slug from the booking URL, e.g. 'ricky-cuts'",
    ),
):
    """
    Args:
        - barber_slug (str): slug used to query a specific barber

    Returns:
        - Object to render a barber's booking page
    """
    try:
        barber = get_barber_by_slug(barber_slug)
    except DatabaseUnavailable:
        # Detail is intentionally generic - the cause is already in the logs,
        # and echoing it back tells an attacker about our schema.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if barber is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found"
        )
    return barber
