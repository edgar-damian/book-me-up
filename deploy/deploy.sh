#!/usr/bin/env bash
#
# Deploy to an EC2 server prepared by deploy/setup-ec2.sh. Tests and builds
# locally, copies the result over with rsync, then restarts both services.
#
#   ./deploy/deploy.sh -h 54.12.34.56 -i ~/keys/webdev.pem
#
# Options:
#   -h HOST   server IP or domain name (required)
#   -i KEY    SSH private key (optional with ssh-agent)
#   -u USER   SSH user (default: ubuntu)
#   -d DIR    app folder on the server (default: /opt/book-me-up)

set -euo pipefail

REMOTE_HOST=""
SSH_KEY=""
REMOTE_USER="ubuntu"
REMOTE_DIR="/opt/book-me-up"
SERVICE="book-me-up"
API_SERVICE="book-me-up-api"

# Also set in setup-ec2.sh.
PYTHON_DIR="/opt/uv-python"

# The help text is the comment block at the top of this file.
usage() {
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    exit 1
}

say() {
    printf '==> %s\n' "$1"
}

die() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

while getopts ":h:i:u:d:" option; do
    case "$option" in
        h) REMOTE_HOST="$OPTARG" ;;
        i) SSH_KEY="$OPTARG" ;;
        u) REMOTE_USER="$OPTARG" ;;
        d) REMOTE_DIR="$OPTARG" ;;
        :) echo "ERROR: -$OPTARG needs a value" >&2; usage ;;
        \?) echo "ERROR: unknown option -$OPTARG" >&2; usage ;;
    esac
done

[ -n "$REMOTE_HOST" ] || { echo "ERROR: -h HOST is required" >&2; usage; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

for tool in npm uv rsync ssh curl; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed on this machine, and deploying needs it."
done

[ -f client/package.json ] && [ -f server/pyproject.toml ] \
    || die "client/package.json or server/pyproject.toml is missing in $PROJECT_DIR"

# accept-new trusts the host key on first connect and rejects it if it changes later.
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
if [ -n "$SSH_KEY" ]; then
    [ -f "$SSH_KEY" ] || die "key file not found: $SSH_KEY"
    SSH_OPTS+=(-i "$SSH_KEY")
fi

TARGET="${REMOTE_USER}@${REMOTE_HOST}"

# Checked before the build so a bad host fails fast. ssh exits 255 when it
# can't connect, and with the remote command's status otherwise.
say "Checking ${TARGET}"
ssh_status=0
ssh "${SSH_OPTS[@]}" "$TARGET" "command -v uv >/dev/null && [ -d '${REMOTE_DIR}' ]" || ssh_status=$?
case "$ssh_status" in
    0) ;;
    255) die "could not connect to ${TARGET} over SSH. Check the address, the key, and that port 22 is open to you." ;;
    *) die "${TARGET} is not set up yet. Run deploy/setup-ec2.sh on it first (that file says how)." ;;
esac

if [ ! -d client/node_modules ]; then
    say "Installing the website's dependencies"
    (cd client && npm ci)
fi

say "Running the API's tests"
(cd server && uv run pytest)

say "Type-checking the website"
(cd client && npm run typecheck)

# Built locally so the 1 GB server only installs runtime packages.
say "Building the website"
(cd client && npm run build)

say "Copying files to ${TARGET}:${REMOTE_DIR}"
# Files are listed explicitly rather than mirroring the project, so untracked
# local files stay local. uv needs server/README.md to build the package.

# -rlpt instead of -a, since local owners and groups don't exist on the server.
copy() {
    rsync -rlptz --exclude '__pycache__' --exclude '.DS_Store' --exclude '.env*' \
        -e "ssh ${SSH_OPTS[*]}" "$@"
}

ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '${REMOTE_DIR}/client' '${REMOTE_DIR}/server'"

# One rsync per folder keeps --delete scoped to it. Combined into a single
# --relative call, macOS rsync deletes the server's node_modules and .venv.
copy --delete client/build/ "${TARGET}:${REMOTE_DIR}/client/build/"
copy --delete server/src/ "${TARGET}:${REMOTE_DIR}/server/src/"
copy client/package.json client/package-lock.json "${TARGET}:${REMOTE_DIR}/client/"
copy server/pyproject.toml server/uv.lock server/.python-version server/README.md \
    "${TARGET}:${REMOTE_DIR}/server/"

say "Installing dependencies and restarting the services"
# If api.env doesn't exist yet, systemd skips the API and the restart still succeeds.
ssh "${SSH_OPTS[@]}" "$TARGET" "
    set -e
    cd '${REMOTE_DIR}/client'
    npm ci --omit=dev
    cd '${REMOTE_DIR}/server'
    UV_PYTHON_INSTALL_DIR='${PYTHON_DIR}' uv sync --locked --no-dev
    sudo systemctl restart ${API_SERVICE} ${SERVICE}
"

say "Checking the website"
# The retries cover the 502s nginx returns while the site starts. With a domain
# as HOST, -L follows the HTTPS redirect, so the certificate is checked too.
if curl -fsL -o /dev/null --retry 10 --retry-delay 1 --max-time 10 "http://${REMOTE_HOST}/"; then
    echo "The website is up."
else
    echo "ERROR: http://${REMOTE_HOST}/ did not answer." >&2
    echo "Check the EC2 security group (port 80 inbound) and the logs:" >&2
    echo "  ssh ${SSH_OPTS[*]} $TARGET 'journalctl -u ${SERVICE} -n 50'" >&2
    exit 1
fi

say "Checking the API"
# "no" means the unit's ConditionPathExists failed, i.e. there is no api.env yet.
api_condition="$(ssh "${SSH_OPTS[@]}" "$TARGET" "systemctl show -p ConditionResult --value ${API_SERVICE}")"

if [ "$api_condition" = "no" ]; then
    echo "The API is off: the server has no /etc/book-me-up/api.env, so only the home page works."
elif curl -fsL -o /dev/null --retry 10 --retry-delay 1 --max-time 10 "http://${REMOTE_HOST}/api/health"; then
    echo "The API is up."
else
    echo "ERROR: the API has its keys, but http://${REMOTE_HOST}/api/health did not answer." >&2
    echo "Check its logs:" >&2
    echo "  ssh ${SSH_OPTS[*]} $TARGET 'journalctl -u ${API_SERVICE} -n 50'" >&2
    exit 1
fi

printf '\n==> Deployed. Open http://%s in your browser.\n' "$REMOTE_HOST"
