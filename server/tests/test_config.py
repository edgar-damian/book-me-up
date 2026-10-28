"""
CORS_ORIGINS is read from the env as a comma-separated string, the form
deploy/setup-ec2.sh writes to api.env. A list field would otherwise be
JSON-decoded first, and a bare URL crashes the API at startup.
"""

import pytest

from server.core.config import Settings


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("https://book-me-up.com", ["https://book-me-up.com"]),
        (
            "https://book-me-up.com, https://www.book-me-up.com",
            ["https://book-me-up.com", "https://www.book-me-up.com"],
        ),
        ("https://a.test,,https://b.test,", ["https://a.test", "https://b.test"]),
    ],
)
def test_cors_origins_splits_comma_separated_env(monkeypatch, raw, expected):
    monkeypatch.setenv("CORS_ORIGINS", raw)
    # _env_file=None keeps a local server/.env out of the result.
    assert Settings(_env_file=None).CORS_ORIGINS == expected


def test_cors_origins_defaults_to_dev_ports(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert Settings(_env_file=None).CORS_ORIGINS == [
        "http://localhost:5173",
        "http://localhost:3000",
    ]
