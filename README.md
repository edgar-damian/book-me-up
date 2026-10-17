# book-me-up

Appointment booking app for barbers and other chair-based service workers.

## 1. Install the prerequisites

| Tool | Version | Get it from |
| --- | --- | --- |
| git | any | your package manager |
| Node.js (includes npm) | 22.22 or newer (24 recommended) | https://nodejs.org |
| uv | any recent | https://docs.astral.sh/uv/getting-started/installation/ |

You don't need to install Python. uv downloads the version the API needs (3.12.12) the first time `./start.sh` runs.

## 2. Run it

```bash
./start.sh              # build the site and start it on http://localhost:3000
./start.sh --dev        # reload on save instead (site on http://localhost:5173)
./start.sh --port 4000  # serve the site on another port
```

`start.sh` checks your tools, installs every dependency, builds the site, starts the API
on `127.0.0.1:8000` and the website, and prints the URL to open. You can run it again
safely. Ctrl+C stops both.

## 3. Add the API keys

The API reads its Supabase keys from `server/.env`:

```bash
cp server/.env.example server/.env   # then fill in the values
```

Without that file, `start.sh` prints a warning, skips the API, and starts only the
website. The home page works, but pages that load shop or barber data don't.

## Database

The database is hosted on Supabase, so there is nothing to set up locally and `start.sh`
never changes it. The schema is `server/sql/create_tables.sql` and the sample data is
`server/sql/mock_data.sql`. Both are run once, by hand, in the Supabase SQL editor.
