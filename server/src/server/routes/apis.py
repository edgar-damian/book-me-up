from fastapi import APIRouter, HTTPException, Path, status
from server.models.public_models import WorkerProfilePublic, EstablishmentPublic
from server.supabase.sb_function import (
    DatabaseUnavailable, 
    get_worker_by_slug,
    get_establishment_by_slug,

)


router = APIRouter()


@router.get("/health")
def health():
    """Liveness probe. Deliberately does not touch the database."""
    return {"status": "ok"}


@router.get(
    "/book-with/{barber_slug}",
    response_model=WorkerProfilePublic,
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
        worker = get_worker_by_slug(barber_slug)
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if worker is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found"
        )
    
    return worker


@router.get(
    "/establishmets/{establishment_slug}",
    response_model=EstablishmentPublic,
    responses={404: {"description": "No active establishment with that slug"}},
)
def book_with(
    establishment_slug: str = Path(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="lowercase slug for an establishment or shop'",
    ),
):
    """
    Args:
        - establishment_slug (str): slug used to query a specific establishment

    Returns:
        - Object to render an establishment's landing page
    """
    try:
        establishment = get_establishment_by_slug(establishment_slug)
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if establishment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Establishment not found"
        )
    
    return establishment


