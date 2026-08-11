"""
Regenerates src/server/models/supabase_models.py from the live database.

HOW TO RUN:
    `uv run python scripts/gen_models.py`
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from server.core.config import settings  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "src/server/models/supabase_models.py"

# PostgREST reports Postgres types in `format`. Map what JSON Schema knows;
# drop the rest so the generator falls back to the plain JSON type.
FORMATS = {
    "timestamp with time zone": "date-time",
    "timestamp without time zone": "date-time",
    "date": "date",
    "time without time zone": "time",
    "uuid": "uuid",
    "bigint": "int64",
    "integer": "int32",
    "smallint": "int32",
}


def main() -> int:
    key = settings.SUPABASE_SECRET_KEY.get_secret_value()
    resp = httpx.get(
        f"{settings.SUPABASE_URL}/rest/v1/",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    resp.raise_for_status()
    defs = resp.json()["definitions"]

    for table, schema in defs.items():
        schema["title"] = "".join(p.capitalize() for p in table.split("_"))
        for prop in schema.get("properties", {}).values():
            fmt = prop.get("format")
            if fmt in FORMATS:
                prop["format"] = FORMATS[fmt]
            else:
                prop.pop("format", None)
            # `gen_random_uuid()` and `x::type` are SQL, not Python defaults.
            default = prop.get("default")
            if isinstance(default, str) and re.search(r"\(\)|::", default):
                prop.pop("default")

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
        json.dump(
            {"$schema": "http://json-schema.org/draft-07/schema#", "definitions": defs},
            tmp,
        )
        tmp_path = tmp.name

    result = subprocess.run(
        [
            "uvx",
            "--from",
            "datamodel-code-generator",
            "datamodel-codegen",
            "--input",
            tmp_path,
            "--input-file-type",
            "jsonschema",
            "--output",
            str(OUT),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--target-python-version",
            "3.12",
            "--use-standard-collections",
            "--use-union-operator",
            "--formatters",
            "black",
        ],
        capture_output=True,
        text=True,
    )
    Path(tmp_path).unlink(missing_ok=True)

    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return result.returncode

    print(f"wrote {OUT.relative_to(Path.cwd())} from {len(defs)} tables")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
