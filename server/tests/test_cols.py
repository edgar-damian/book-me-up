"""
This test insures that PII cols from the User table are not able to
be obtained by other tables
"""

from server.models.public_models import (
    EstablishmentLandingPage,
    WorkerLandingPage,
    to_public,
)
from server.supabase.sb_function import _cols

PRIVATE = {"user_id", "hashed_password", "is_platform_admin"}


def test_to_public_drops_undeclared_fields(worker_row, private_leak_fields):
    obj = to_public(WorkerLandingPage, {**worker_row, **private_leak_fields})
    assert PRIVATE.isdisjoint(obj.model_dump())


def test_cols_lists_model_fields():
    cols = _cols(EstablishmentLandingPage.Workers)
    assert set(cols.split(", ")) == set(EstablishmentLandingPage.Workers.model_fields)


def test_cols_substitutes_embed_expression():
    cols = _cols(EstablishmentLandingPage, workers="workers:worker_establishment(id)")
    assert "workers:worker_establishment(id)" in cols
    assert ", workers," not in f", {cols},"
