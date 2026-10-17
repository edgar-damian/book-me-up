import os
from uuid import uuid4

os.environ.update(
    {
        "APP_ENV": "local",
        "SB_DB_PASSWORD_ON_SETUP": "test",
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_JWKS_URL": "https://test.supabase.co/auth/v1/.well-known/jwks.json",
        "SUPABASE_DB_URL": "postgresql://test",
        "SUPABASE_SECRET_KEY": "test-secret",
        "SUPABASE_PUBLISHABLE_KEY": "test-publishable",
    }
)

import pytest
from fastapi.testclient import TestClient

from server.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def worker_row():
    """A raw worker_profile row shaped the way PostgREST returns it."""
    wid = str(uuid4())
    return {
        "id": wid,
        "slug": "ricky-cuts",
        "first_name": "Ricky",
        "last_name": "Reyes",
        "bio": "Fades and beard work.",
        "public_email": "ricky@example.com",
        "public_phone": "+15555550123",
        "image": None,
        "is_active": True,
        "hold_expiry_hours": 24,
        "auto_accept": False,
        "min_lead_time_min": 60,
        "max_advance_days": 30,
        "cancellation_cutoff_min": 120,
        "services": [
            {
                "id": str(uuid4()),
                "worker_id": wid,
                "title": "Skin fade",
                "description": "Includes lineup.",
                "image": None,
                "price_cents": 3500,
                "duration_min": 45,
                "is_active": True,
            }
        ],
        "chairs": [
            {
                "id": str(uuid4()),
                "establishment": {
                    "id": str(uuid4()),
                    "slug": "downtown-cuts",
                    "name": "Downtown Cuts",
                    "address": "512 Congress Ave",
                    "city": "Austin",
                    "state": "TX",
                    "zip": "78701",
                    "lat": 30.2672,
                    "lng": -97.7431,
                    "timezone": "America/Chicago",
                    "phone": "+15125550100",
                    "email": "hello@downtowncuts.test",
                },
                "schedule_days": [{"day_of_week": 2, "start_minute": 540, "end_minute": 1020}],
            }
        ],
    }


@pytest.fixture
def private_leak_fields():
    """User columns that must never survive projection onto a public model."""
    return {
        "user_id": str(uuid4()),
        "hashed_password": "$2b$12$notarealhash",
        "is_platform_admin": True,
    }
