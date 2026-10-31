"""
The signed-in worker's own setup. Every route acts as the caller, so RLS decides
what each one can read and write.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from server.models.dashboard import (
    AnswerRequest,
    JoinShop,
    MyAppointment,
    MyChair,
    MyService,
    MyTimeOff,
    MyWeek,
    MyWorkerProfile,
    SaveSchedule,
    SaveServices,
    SaveTimeOff,
    SaveWorkerProfile,
    ScheduleDay,
)
from server.routes.auth import _not_signed_in, current_user
from server.supabase.auth import Caller
from server.supabase.dashboard import (
    InvalidProfile,
    InvalidService,
    ProfileMissing,
    RequestClosed,
    SlugTaken,
    answer_request,
    get_chairs,
    get_profile,
    get_services,
    get_time_off,
    get_week,
    request_chair,
    save_profile,
    save_schedule,
    save_services,
    save_time_off,
)
from server.supabase.sb_function import DatabaseUnavailable, NotSignedIn

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "/profile",
    response_model=MyWorkerProfile,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "No worker profile yet"},
    },
)
def read_profile(caller: Annotated[Caller, Depends(current_user)]):
    """The caller's own worker profile, hidden or live, for the profile form."""
    try:
        profile = get_profile(caller)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No worker profile yet")
    return profile


@router.put(
    "/profile",
    response_model=MyWorkerProfile,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        409: {"description": "Another worker's page uses this slug"},
        422: {"description": "A blank name, an unusable email or phone, or a malformed slug"},
    },
)
def write_profile(profile: SaveWorkerProfile, caller: Annotated[Caller, Depends(current_user)]):
    """
    Updates the caller's worker profile, or creates it when they have none. A new
    profile starts hidden.
    """
    try:
        return save_profile(caller, profile)
    except InvalidProfile as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except SlugTaken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That link is taken, try another",
        )
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get(
    "/chairs",
    response_model=list[MyChair],
    responses={401: {"description": "Missing, invalid, or expired access token"}},
)
def read_chairs(caller: Annotated[Caller, Depends(current_user)]):
    """The shops the caller works at or has asked to join, for the shop step."""
    try:
        return get_chairs(caller)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.put(
    "/join-request",
    response_model=MyChair,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "No live shop has this slug"},
        409: {"description": "No worker profile yet"},
        422: {"description": "A malformed slug"},
    },
)
def write_join_request(body: JoinShop, caller: Annotated[Caller, Depends(current_user)]):
    """
    Asks to join a shop by its slug. The request waits, inactive, until the shop's
    owner accepts it, and a request still waiting at another shop is withdrawn.
    """
    try:
        chair = request_chair(caller, body.slug)
    except ProfileMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Set up your profile first",
        )
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if chair is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That's not an existing shop",
        )
    return chair


@router.put(
    "/chairs/{chair_id}/schedule",
    response_model=list[ScheduleDay],
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "Not one of the caller's current chairs"},
        422: {"description": "A day that ends before it starts, a bad break, or a repeated day"},
    },
)
def write_schedule(
    chair_id: UUID, body: SaveSchedule, caller: Annotated[Caller, Depends(current_user)]
):
    """Sets the caller's week at one of their chairs. Days left out are closed."""
    try:
        days = save_schedule(caller, chair_id, body.days)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if days is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such chair")
    return days


@router.get(
    "/chairs/{chair_id}/appointments",
    response_model=MyWeek,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "Not one of the caller's current chairs"},
    },
)
def read_week(chair_id: UUID, caller: Annotated[Caller, Depends(current_user)]):
    """
    The caller's next seven days at one of their chairs, in the shop's time zone,
    with their bookings and which days are off.
    """
    try:
        week = get_week(caller, chair_id)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if week is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such chair")
    return week


@router.put(
    "/appointments/{appointment_id}/status",
    response_model=MyAppointment,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "Not one of the caller's bookings"},
        409: {"description": "The booking isn't waiting on an answer anymore"},
        422: {"description": "An answer other than ACCEPTED or REJECTED"},
    },
)
def write_answer(
    appointment_id: UUID, body: AnswerRequest, caller: Annotated[Caller, Depends(current_user)]
):
    """
    Accepts or rejects one of the caller's booking requests. Answering the same way
    again changes nothing.
    """
    try:
        answered = answer_request(caller, appointment_id, body.status)
    except RequestClosed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This booking isn't waiting on an answer anymore",
        )
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if answered is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such booking")
    return answered


@router.get(
    "/services",
    response_model=list[MyService],
    responses={401: {"description": "Missing, invalid, or expired access token"}},
)
def read_services(caller: Annotated[Caller, Depends(current_user)]):
    """The services the caller offers, oldest first, for the services step."""
    try:
        return get_services(caller)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.put(
    "/services",
    response_model=list[MyService],
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        409: {"description": "No worker profile yet"},
        422: {"description": "A blank name, a bad price or length, or a repeated service"},
    },
)
def write_services(body: SaveServices, caller: Annotated[Caller, Depends(current_user)]):
    """
    Makes the posted list the caller's whole menu. A saved service left out is
    turned off, so the appointments booked for it keep their history.
    """
    try:
        return save_services(caller, body.services)
    except InvalidService as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except ProfileMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Set up your profile first",
        )
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )


@router.get(
    "/time-off",
    response_model=MyTimeOff,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "Not one of the caller's current chairs"},
    },
)
def read_time_off(chair: UUID, caller: Annotated[Caller, Depends(current_user)]):
    """
    The caller's time off still to come, with the days on the calendar of the shop
    at one of their chairs, and the bookings it overlaps at every shop.
    """
    try:
        time_off = get_time_off(caller, chair)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if time_off is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such chair")
    return time_off


@router.put(
    "/time-off",
    response_model=MyTimeOff,
    responses={
        401: {"description": "Missing, invalid, or expired access token"},
        404: {"description": "Not one of the caller's current chairs"},
        422: {"description": "A stretch that ends before it starts, or a repeated stretch"},
    },
)
def write_time_off(
    chair: UUID, body: SaveTimeOff, caller: Annotated[Caller, Depends(current_user)]
):
    """
    Makes the posted stretches the caller's time off still to come, with the days
    on the calendar of the shop at one of their chairs. It is saved even over
    bookings, which come back with it.
    """
    try:
        time_off = save_time_off(caller, chair, body.stretches)
    except NotSignedIn:
        raise _not_signed_in()
    except DatabaseUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        )

    if time_off is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such chair")
    return time_off
