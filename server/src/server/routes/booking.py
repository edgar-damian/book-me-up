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

from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from server.models.booking import (
    AppointmentBooked,
    BookAppointment,
    DatesAvailable,
    TimesAvailable,
)
from server.supabase.booking import (
    BlankFirstName,
    DatabaseUnavailable,
    SlotTaken,
    get_dates,
    get_times,
    make_appointment,
)

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
def times_available(establishment_id: UUID, worker_id: UUID, service_id: UUID, day: date):
    """
    Step 2 of the booking flow. The user already picked an establishment, service, worker,
    and a valid date. Now they have to choose form the available timeslots in the chosen day.
    """
    try:
        times = get_times(establishment_id, worker_id, service_id, day)
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
    "/appointments",
    response_model=AppointmentBooked,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"description": "No active chair here, or no such service for this worker"},
        409: {"description": "Slot was taken while the client was deciding"},
    },
)
def save_appointment(apt: BookAppointment):
    """
    Step 3 of the booking flow. The client picked a slot and gave us their details.
    We save the appointment and hand back what got booked.
    """
    try:
        appointment = make_appointment(apt)
    except BlankFirstName:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="First name is required",
        )
    except SlotTaken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That time was just booked, please pick another",
        )
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Establishment, worker, or service not found",
        )

    return appointment
