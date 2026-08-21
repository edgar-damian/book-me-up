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

from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from server.models.booking import DatesAvailable, TimesAvailable
from server.supabase.booking import DatabaseUnavailable, get_dates, get_times

router = APIRouter(prefix="/booking", tags=["booking"])


@router.get(
    "/establishment/{establishment_id}/worker/{worker_id}/service/{service_id}/dates",
    response_model=DatesAvailable,
    responses={404: {"description": "No active chair here, or no such service for this worker"}},
)
def dates_available(establishment_id: UUID, worker_id: UUID, service_id: UUID):
    """
    Step 1 of the booking flow. The user picks an establishment, worker, and service.
    We render a list of dates available to choose from.
    """
    try:
        dates = get_dates(establishment_id, worker_id, service_id)
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if dates is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Establishment, worker, or service not found",
        )

    return dates


@router.get(
    "/establishment/{establishment_id}/worker/{worker_id}/service/{service_id}/times",
    response_model=TimesAvailable,
    responses={404: {"description": "Error fetching dates, please try again"}},
)
def times_available(establishment_id: UUID, worker_id: UUID, service_id: UUID):
    """
    Step 2 of the booking flow. The user already picked an establishment, service, worker,
    and a valid date. Now they have to choose form the available timeslots in the chosen day. 
    """
    try:
        times = get_times(establishment_id, worker_id, service_id)
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if times is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Times slots for this service not found",
        )

    return times


@router.post(
    "/establishment/{establishment_id}/worker/{worker_id}/service/{service_id}/times",
    response_model=TimesAvailable,
    responses={404: {"description": "Error fetching dates, please try again"}},
)
def times_available(establishment_id: UUID, worker_id: UUID, service_id: UUID):
    """
    Step 2 of the booking flow. The user already picked an establishment, service, worker,
    and a valid date. Now they have to choose form the available timeslots in the chosen day. 
    """
    try:
        times = get_times(establishment_id, worker_id, service_id)
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if times is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Times slots for this service not found",
        )

    return times