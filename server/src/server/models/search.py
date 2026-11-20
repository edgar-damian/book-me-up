"""
Result cards for the search page. Every search, blanket or by text, returns a
list of these:

    By shop       list[SearchResultShop]                        A to Z by name
    By worker     list[SearchResultWorker]                      A to Z by first, then last name
    By location   list[SearchResultShop | SearchResultWorker]   A to Z by city, then name

`kind` tells the two apart in the mixed location list. It is computed rather
than declared, so _cols() leaves it out of the select list.

Field names double as the PostgREST select list through _cols(), so `shops`
needs an embed expression and any new field is a new column in the query.
"""

from typing import Literal

from pydantic import BaseModel, Field, computed_field


class SearchResultShop(BaseModel):
    """
    One shop card. slug links to the shop's landing page, /shops/{slug}.
    """

    slug: str
    name: str
    address: str
    city: str
    state: str
    zip: str
    images: list[str] = Field(description="The card shows the first one, if any")

    @computed_field
    @property
    def kind(self) -> Literal["shop"]:
        return "shop"


class SearchResultWorker(BaseModel):
    """
    One worker card. slug links to the worker's landing page,
    /view-services/{slug}.
    """

    class Shop(BaseModel):
        """
        A shop where the worker has an active chair. Fills the "at ..." line
        on the card, and city/state is what a location search matches and
        groups on.
        """

        slug: str
        name: str
        city: str
        state: str

    slug: str
    first_name: str
    last_name: str
    image: str | None = None
    shops: list[Shop] = Field(
        description="One per active chair, at active shops only. In the location list, "
        "only the shops in that card's city."
    )

    @computed_field
    @property
    def kind(self) -> Literal["worker"]:
        return "worker"
