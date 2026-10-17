from fastapi import APIRouter, HTTPException, Path, status

from server.models.public_models import EstablishmentLandingPage, JoinWaitlist, WorkerLandingPage
from server.supabase.sb_function import (
    DatabaseUnavailable,
    get_establishment_by_slug,
    get_worker_by_slug,
)
from server.supabase.waitlist import InvalidSignup, join_waitlist

router = APIRouter()


@router.get("/health")
def health():
    """Liveness probe. Deliberately does not touch the database."""
    return {"status": "ok"}


@router.get(
    "/workers/{barber_slug}",
    response_model=WorkerLandingPage,
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found")

    return worker


@router.get(
    "/establishments/{establishment_slug}",
    response_model=EstablishmentLandingPage,
    responses={404: {"description": "No active establishment with that slug"}},
)
def establishment(
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Establishment not found")

    return establishment


@router.post(
    "/waitlist",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={422: {"description": "Missing or unusable name, phone, or email"}},
)
def waitlist(signup: JoinWaitlist):
    """
    Args:
        - signup (JoinWaitlist): first and last name, E.164 phone, and email

    Returns:
        - Nothing. A repeat email gets the same 204 as a new signup.
    """
    try:
        join_waitlist(signup)
    except InvalidSignup as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except DatabaseUnavailable:
        # Vague on purpose, logs are more descriptive and private
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )
