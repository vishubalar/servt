# Pre-Installation White-Label Configurator

Zero-dependency local Web UI to customize your panel's **Brand Name**, **Primary Hex Color**, **Logos / Marks / Favicons**, and optional repository/deployment settings before running `install.sh` or committing to your fork.

## Quick Start

From the repository root (requires Node.js 18+, no `npm install` needed):

```bash
node preinstall/server.mjs
```

Then open in your browser:

```
http://127.0.0.1:3456
```

## CLI & Environment Options

| Option / Env Var | Default | Description |
| --- | --- | --- |
| `--port=3456` / `PORT` | `3456` | HTTP port to listen on |
| `--host=127.0.0.1` / `HOST` | `127.0.0.1` | Bind address (use `--host=0.0.0.0` for remote access) |

Example on a custom port:

```bash
node preinstall/server.mjs --port=4000
```

## What "Save & Apply to Repo" Updates

- **Uploaded brand assets**: saved into `frontend/public/brand/` (and optional `backend/public/favicon.ico`)
- **Backend defaults**: `backend/config/branding.php`, `backend/app/Support/BrandColor.php`, `backend/.env.example` (and `backend/.env` if present)
- **Frontend defaults**: `frontend/lib/branding/merge-branding.js`, `frontend/app/layout.jsx`
- **Deployment / update URLs** (when provided): `install.sh` (`REPO_URL`), `backend/config/panel_update.php` (`releases_url`), `backend/config/central.php` (`url`)
- **Test expectations**: `backend/tests/Feature/BrandingTest.php`, `backend/tests/Feature/BrandPagesTest.php`, `frontend/tests/branding.test.mjs`

## Offline / Airgapped Usage

`preinstall/index.html` uses zero external CDNs or fonts. You can also open it directly in a browser to preview themes and download `branding.env` offline.
