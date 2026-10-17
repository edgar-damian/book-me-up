#!/usr/bin/env bash
#
# Run the website and the API locally.
#
#   ./start.sh              build and serve the site on http://localhost:3000
#   ./start.sh --dev        dev server with reload on http://localhost:5173
#   ./start.sh --port 4000  serve the site on another port
#   ./start.sh --help       show this message
#
# The API runs on http://127.0.0.1:8000 (override with API_PORT).
# Ctrl+C stops both.

set -euo pipefail

# Written for bash 3.2, the macOS default.

# From the "engines" field in react-router's package.json.
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=22

API_PORT="${API_PORT:-8000}"

DEV_MODE="false"
PORT_OVERRIDE=""

say() {
    printf '==> %s\n' "$1"
}

# warn "message" ["detail line" ...]
warn() {
    printf 'WARNING: %s\n' "$1" >&2
    shift
    for line in "$@"; do
        printf '         %s\n' "$line" >&2
    done
}

die() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

# The help text is the comment block at the top of this file.
usage() {
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    exit 0
}

# Succeeds if something is listening on port $1. Uses node since curl isn't
# always installed.
listening() {
    node -e '
        const socket = require("net").connect(Number(process.argv[1]), "127.0.0.1");
        socket.setTimeout(1000, () => process.exit(1));
        socket.on("connect", () => process.exit(0));
        socket.on("error", () => process.exit(1));
    ' "$1"
}

# Parsed by hand because getopts only handles one-letter flags.
while [ $# -gt 0 ]; do
    case "$1" in
        -d|--dev)
            DEV_MODE="true"
            shift
            ;;
        -p|--port)
            [ $# -ge 2 ] || die "--port needs a number, for example: --port 4000"
            case "$2" in
                ''|*[!0-9]*) die "--port needs a number, got '$2'" ;;
            esac
            PORT_OVERRIDE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            die "unknown option '$1' (try --help)"
            ;;
    esac
done

case "$API_PORT" in
    ''|*[!0-9]*) die "API_PORT needs to be a number, got '${API_PORT}'" ;;
esac

if [ -n "$PORT_OVERRIDE" ]; then
    WEB_PORT="$PORT_OVERRIDE"
elif [ "$DEV_MODE" = "true" ]; then
    WEB_PORT=5173
else
    WEB_PORT=3000
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

command -v node >/dev/null 2>&1 \
    || die "Node.js is not installed. Get it from https://nodejs.org (version ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} or newer)."

if ! node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    const ok = major > ${REQUIRED_NODE_MAJOR}
        || (major === ${REQUIRED_NODE_MAJOR} && minor >= ${REQUIRED_NODE_MINOR});
    process.exit(ok ? 0 : 1);
"; then
    die "Node $(node --version) is too old. This app needs version ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} or newer."
fi

command -v npm >/dev/null 2>&1 || die "npm is not installed, but Node.js is. Reinstall Node from https://nodejs.org."

# No Python check, since uv installs the version in server/.python-version.
command -v uv >/dev/null 2>&1 \
    || die "uv is not installed. Get it from https://docs.astral.sh/uv/getting-started/installation/ (it installs the right Python by itself)."

[ -f client/package.json ] && [ -f server/pyproject.toml ] \
    || die "client/package.json or server/pyproject.toml is missing. Run this script from a full copy of the project."

for port in "$WEB_PORT" "$API_PORT"; do
    if listening "$port"; then
        die "port ${port} is already in use. Is start.sh already running in another terminal? (--port moves the site, API_PORT moves the API)"
    fi
done

# npm ci wipes node_modules first, so it only runs on a fresh checkout or after
# package-lock.json changes. npm rewrites this file at the end of every install.
INSTALL_MARKER="client/node_modules/.package-lock.json"

if [ ! -d client/node_modules ]; then
    say "Installing the website's dependencies (this happens once, and takes a moment)"
    (cd client && npm ci)
elif [ ! -f "$INSTALL_MARKER" ] || [ client/package-lock.json -nt "$INSTALL_MARKER" ]; then
    say "The website's dependencies changed since your last install, updating them"
    (cd client && npm ci)
fi

say "Installing the API's dependencies"
(cd server && uv sync --locked)

# Prints the settings that are missing or blank, and fails if there are any.
# Reads them from config.py so the list can't drift.
config_problems() {
    server/.venv/bin/python - <<'PY'
import sys

from pydantic import ValidationError

try:
    from server.core.config import settings
except ValidationError as e:
    print(" ".join(sorted({str(err["loc"][0]) for err in e.errors()})))
    sys.exit(1)

blank = []
for name, field in type(settings).model_fields.items():
    value = getattr(settings, name)
    if hasattr(value, "get_secret_value"):
        value = value.get_secret_value()
    if field.is_required() and not str(value).strip():
        blank.append(name)

if blank:
    print(" ".join(blank))
    sys.exit(1)
PY
}

# Without its keys the API can't start, so the website runs alone. The home
# page doesn't call the API.
START_API="true"

if ! CONFIG_PROBLEMS="$(config_problems)"; then
    START_API="false"
    if [ ! -f server/.env ]; then
        reason="server/.env does not exist (it holds the Supabase keys)."
    elif [ -n "$CONFIG_PROBLEMS" ]; then
        reason="server/.env is missing or has blank values for: ${CONFIG_PROBLEMS}"
    else
        reason="the API's settings could not be loaded (the error is above)."
    fi
    warn "$reason" \
        "The API will not start, so only the home page will work." \
        "To fix it: cp server/.env.example server/.env, fill in the keys, and run this again."
fi

if [ "$DEV_MODE" = "false" ]; then
    say "Building the website"
    (cd client && npm run build)
fi

# 127.0.0.1 rather than localhost, because Node can resolve localhost to ::1
# and uvicorn only listens on IPv4.
export API_URL="http://127.0.0.1:${API_PORT}"

API_PID=""

stop_api() {
    if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
        kill "$API_PID" 2>/dev/null || true
        wait "$API_PID" 2>/dev/null || true
    fi
}

trap stop_api EXIT
trap 'exit 130' INT TERM

if [ "$START_API" = "true" ]; then
    api_cmd=(.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port "$API_PORT")
    if [ "$DEV_MODE" = "true" ]; then
        api_cmd+=(--reload --reload-dir src)
    fi

    say "Starting the API on http://127.0.0.1:${API_PORT}"
    # exec so that $! is uvicorn's PID rather than the subshell's.
    (cd server && exec "${api_cmd[@]}") &
    API_PID=$!

    tries=0
    until listening "$API_PORT"; do
        if ! kill -0 "$API_PID" 2>/dev/null; then
            API_PID=""
            warn "The API stopped while starting (its error is above)." \
                "Starting the website anyway, but only the home page will work."
            break
        fi
        tries=$((tries + 1))
        if [ "$tries" -ge 40 ]; then
            warn "The API is still not answering after 20 seconds." \
                "Starting the website anyway. Pages that need the API will fail until it does."
            break
        fi
        sleep 0.5
    done
fi

say "Open http://localhost:${WEB_PORT}  (Ctrl+C stops everything)"

if [ "$DEV_MODE" = "true" ]; then
    say "Dev mode: the site and the API reload when you save a file"
    (cd client && npm run dev -- --port "$WEB_PORT" --strictPort)
else
    # Without PORT, react-router-serve silently moves to another port when this
    # one is taken. Without HOST, it listens on every network interface.
    (cd client && HOST=127.0.0.1 PORT="$WEB_PORT" npm run start)
fi
