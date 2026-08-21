"""
Includes routes/APIs used in the booking flow. There are 
3 steps to the flow as follows: 
    1) User already picked a Service from a Worker. They need to get shown 
        a calendar with days available.
    2) User picks a day, then they must get shown a list of slots that are
        available for this given service.
    3) User picks a date with a time. This needs to get posted on the db 
        so Workers can see it and clients get that slot as unavailable.
"""

from fastapi import APIRouter, HTTPException, Path, status
from uuid import UUID
from server.models.booking import DatesAvailable
from server.supabase.sb_function import (
    DatabaseUnavailable,
    get_establishment_by_slug,
    get_worker_by_slug,
)

router = APIRouter()

@router.get(
    "worker/{worker_id}/service/{service_id}/dates-available",
    response_model=DatesAvailable,
    responses={404: {"description": "Invalid worker_id or service_id"}},
)
def get_dates(
    worker_id: UUID,
    service_id: UUID
):
    """

    """
    try:
        dates = get_dates(worker_id, service_id)
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if dates is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker or Service not found")

    return dates