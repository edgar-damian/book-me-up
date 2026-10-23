#!/usr/bin/env bash
#
# One-time setup for a fresh Ubuntu 24.04 EC2 server. Safe to re-run.
#
#   scp -i ~/keys/mykey.pem -r deploy ubuntu@<PUBLIC-IP>:~
#   ssh -i ~/keys/mykey.pem ubuntu@<PUBLIC-IP>
#   sudo CERT_EMAIL=you@example.com bash deploy/setup-ec2.sh
#
# Installs Node, uv, nginx and certbot, creates the service account, and
# registers both services with systemd. Requests an HTTPS certificate once DNS
# points at the server. CERT_EMAIL is optional and only receives expiry notices.
#
# Code is deployed afterwards with deploy/deploy.sh.

set -euo pipefail

APP_NAME="book-me-up"
APP_DIR="/opt/book-me-up"
APP_USER="bookmeup"

# Same as CI and client/Dockerfile.
NODE_MAJOR="24"
# Same as the development machine.
UV_VERSION="0.12.1"

# uv's default location is in the deploy user's home, which the service account
# can't read. Also set in deploy.sh.
PYTHON_DIR="/opt/uv-python"

# Holds api.env, the API's Supabase keys, and web.env, the website's cookie secret.
SECRETS_DIR="/etc/book-me-up"

# Also in nginx-book-me-up-https.conf.
DOMAIN="book-me-up.com"
WEBROOT="/var/www/certbot"
CERT_EMAIL="${CERT_EMAIL:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# The sudo caller owns the app folder, so deploy.sh can rsync without sudo.
DEPLOY_USER="${SUDO_USER:-root}"

say() {
    printf '\n==> %s\n' "$1"
}

die() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

[ "$(id -u)" -eq 0 ] || die "run this with sudo: sudo bash $0"

[ -r /etc/os-release ] || die "cannot read /etc/os-release; unsupported system"
# shellcheck disable=SC1091
. /etc/os-release

[ "${ID:-}" = "ubuntu" ] || die "this script is for Ubuntu, but this is ${PRETTY_NAME:-${ID:-unknown}}"

export DEBIAN_FRONTEND=noninteractive

say "Detected ${PRETTY_NAME}"

# A t2.micro has 1 GB of RAM and no swap, which npm and uv installs can exceed.
if [ -z "$(swapon --show)" ]; then
    say "Adding a 1 GB swap file"
    [ -f /swapfile ] || fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    say "Swap is already on, leaving it alone"
fi

say "Installing Node.js ${NODE_MAJOR}, nginx and certbot"

apt-get update -y
apt-get install -y curl rsync
# NodeSource carries newer Node releases than Ubuntu's repositories.
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
# Ubuntu's certbot package includes a renewal timer.
apt-get install -y nodejs nginx certbot

say "Node $(node --version), npm $(npm --version)"

say "Installing uv ${UV_VERSION}"

if [ "$(uv --version 2>/dev/null | cut -d' ' -f2)" = "$UV_VERSION" ]; then
    echo "uv ${UV_VERSION} is already installed"
else
    curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" \
        | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

say "Creating the '$APP_USER' service account"

if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
else
    echo "user '$APP_USER' already exists, leaving it alone"
fi

say "Creating $APP_DIR, $PYTHON_DIR and $SECRETS_DIR"

# The deploy user owns the code, and the service account reads it through its group.
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

mkdir -p "$PYTHON_DIR"
chown "$DEPLOY_USER" "$PYTHON_DIR"
chmod 755 "$PYTHON_DIR"

# systemd reads api.env as root, so the service account needs no access to it.
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# The website's cookie secret is generated here, so it never leaves this server.
# A re-run keeps it, since a new one would log everyone out.
if [ ! -s "$SECRETS_DIR/web.env" ]; then
    secret="$(openssl rand -hex 32)"
    (umask 077 && printf 'SESSION_SECRET=%s\n' "$secret" > "$SECRETS_DIR/web.env")
else
    echo "$SECRETS_DIR/web.env already exists, leaving it alone"
fi

say "Installing the systemd services"

# Separate units, so the website keeps serving the home page if the API is down.
for unit in "$APP_NAME" "${APP_NAME}-api"; do
    install -m 644 "$SCRIPT_DIR/${unit}.service" "/etc/systemd/system/${unit}.service"
done
systemctl daemon-reload
systemctl enable "$APP_NAME" "${APP_NAME}-api"

say "Configuring nginx as a reverse proxy on port 80"

mkdir -p "$WEBROOT"
install -m 644 "$SCRIPT_DIR/nginx-${APP_NAME}-proxy.conf" "/etc/nginx/snippets/${APP_NAME}-proxy.conf"
install -m 644 "$SCRIPT_DIR/nginx-${APP_NAME}.conf" "/etc/nginx/conf.d/${APP_NAME}.conf"

# Ubuntu's default site also claims default_server on port 80.
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl restart nginx

say "Setting up HTTPS for ${DOMAIN}"

# Fails until DNS points at this server. The site stays on HTTP until a later
# run succeeds.
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -n "$CERT_EMAIL" ]; then
    email_args=(--email "$CERT_EMAIL")
else
    email_args=(--register-unsafely-without-email)
fi

if [ ! -f "$CERT" ]; then
    # certbot saves the deploy hook with the certificate, so renewals reload nginx too.
    certbot certonly --webroot -w "$WEBROOT" \
        --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.${DOMAIN}" \
        --non-interactive --agree-tos "${email_args[@]}" \
        --deploy-hook "systemctl reload nginx" \
        || true
fi

if [ -f "$CERT" ]; then
    install -m 644 "$SCRIPT_DIR/nginx-${APP_NAME}-https.conf" "/etc/nginx/conf.d/${APP_NAME}-https.conf"
    HTTPS_URL="https://${DOMAIN}"
else
    # nginx won't start with the HTTPS config while the certificate is missing.
    rm -f "/etc/nginx/conf.d/${APP_NAME}-https.conf"
    HTTPS_URL="(none yet: point ${DOMAIN} and www.${DOMAIN} here, then run this again)"
    printf 'WARNING: no HTTPS certificate yet, so the site stays on plain HTTP.\n' >&2
fi

nginx -t
systemctl reload nginx

cat <<EOF

==> Server setup is complete. Remaining steps, from the project folder:

1. Copy the API keys to the server (once):

     { cat server/.env; echo APP_ENV=production; echo CORS_ORIGINS=https://book-me-up.com; } \\
         | ssh -i ~/keys/<key>.pem ubuntu@<PUBLIC-IP> 'sudo sh -c "umask 077; cat > /etc/book-me-up/api.env"'

   Without it the website still runs, but only the home page works. The next
   deploy starts the API.

2. Deploy:

     ./deploy/deploy.sh -h <PUBLIC-IP> -i ~/keys/<key>.pem

HTTPS: ${HTTPS_URL}

Handy commands on this server:
    sudo systemctl status ${APP_NAME} ${APP_NAME}-api
    journalctl -u ${APP_NAME} -u ${APP_NAME}-api -f
    sudo systemctl restart ${APP_NAME} ${APP_NAME}-api

EOF
