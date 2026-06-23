# Production Deployment And Multi-Client OAuth

This document describes the target production architecture for Cloud Travel Guide and the OAuth strategy for both the Electron desktop client and the future web application.

## Goals

- Keep one backend API platform shared by desktop, web, and future clients.
- Use a production-safe OAuth flow per client type.
- Avoid exposing OAuth access tokens in browser URLs.
- Avoid making Electron depend on browser cookies.
- Keep provider callbacks stable and controlled by the backend.
- Make deployment, scaling, secrets, and database migrations explicit.

## Target Architecture

```text
Electron Desktop App
Web App
Future Mobile / CLI Clients
        |
        v
Backend API: FastAPI
        |
PostgreSQL
        |
GitHub / Google OAuth
```

Recommended production domains:

```text
Web app:      https://travel.example.com
Backend API:  https://api.example.com
Desktop URI:  cloud-travel-guide://auth/callback
```

Provider callback URLs should point to the backend only:

```text
https://api.example.com/api/v1/auth/oauth/github/callback
https://api.example.com/api/v1/auth/oauth/google/callback
```

## Deployment Model

### Backend

Deploy the backend as a containerized FastAPI service:

```text
Docker image -> Render / Fly.io / ECS / Kubernetes / VPS Docker Compose
```

Production startup should not use reload mode:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

For larger deployments, run multiple workers behind a reverse proxy or process manager.

Database migrations are a deployment step:

```bash
uv run alembic upgrade head
```

Alembic is the source of truth for schema management. `init.sql` is only a Docker bootstrap placeholder.

### Database

Use managed PostgreSQL in production:

- Neon
- Supabase
- AWS RDS
- Google Cloud SQL
- Railway PostgreSQL

Backups, point-in-time recovery, SSL, and connection pooling should be enabled by the hosting platform where possible.

### Web App

Deploy the web app separately from the backend:

```text
Vercel / Netlify / Cloudflare Pages / self-hosted Next.js
```

Production web environment:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

### Electron App

Electron is distributed as a signed desktop application:

```text
Windows: NSIS / portable
macOS: DMG
Linux: AppImage / deb
```

The app registers a custom protocol:

```text
cloud-travel-guide://auth/callback
```

The renderer should not own long-lived tokens. Tokens are stored through the Electron main process using OS-backed secure storage when available.

## Production Environment

Backend production configuration:

```env
ENVIRONMENT=production
DATABASE_URL=postgresql://...
SECRET_KEY=<strong random string at least 32 chars>
ACCESS_TOKEN_EXPIRE_MINUTES=10080

CORS_ORIGINS=https://travel.example.com
OAUTH_REDIRECT_ORIGINS=https://travel.example.com
OAUTH_BACKEND_CALLBACK_BASE=https://api.example.com

AUTH_COOKIE_SECURE=true
DESKTOP_OAUTH_REDIRECT_URI=cloud-travel-guide://auth/callback
DESKTOP_OAUTH_CODE_EXPIRE_SECONDS=120

GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Security rules:

- `SECRET_KEY` must not use the development default.
- `AUTH_COOKIE_SECURE=true` is required in production.
- Wildcard CORS is not allowed in production.
- OAuth redirect origins must be explicit.

## OAuth Flows

### Web OAuth Flow

```text
Web app
  -> GET /api/v1/auth/oauth/{provider}?client_type=web&redirect_uri=https://travel.example.com/auth/callback
Backend
  -> redirects to GitHub / Google
Provider
  -> redirects to backend callback
Backend callback
  -> exchanges provider code
  -> creates app token
  -> sets HttpOnly Secure SameSite=Lax cookie
  -> redirects to web /auth/callback?oauth=success
Web callback
  -> calls /me with credentials
  -> restores session
```

The access token is never placed in the browser URL.

### Electron OAuth Flow

```text
Electron renderer
  -> asks main process to open system browser
System browser
  -> GET /api/v1/auth/oauth/{provider}?client_type=desktop&redirect_uri=cloud-travel-guide://auth/callback
Backend
  -> redirects to GitHub / Google
Provider
  -> redirects to backend callback
Backend callback
  -> exchanges provider code
  -> creates short-lived one-time desktop login code
  -> redirects to cloud-travel-guide://auth/callback?code=...
Electron main process
  -> receives deep link
  -> forwards callback to renderer through preload IPC
Electron renderer
  -> POST /api/v1/auth/oauth/desktop/exchange with one-time code
Backend
  -> consumes one-time code
  -> returns app token
Electron
  -> stores token through main process secure storage
```

The one-time code is:

- Random.
- Stored only as a SHA-256 hash.
- Short-lived.
- Single-use.
- Exchanged for a normal app token by the desktop app.

### Logout And Re-Authorization

Logout performs:

- App JWT blacklist.
- Web HttpOnly cookie clear.
- Electron secure token clear.
- Best-effort GitHub / Google OAuth grant revocation.
- Local provider access/refresh token cleanup.

GitHub / Google account cookies are controlled by the provider and cannot be cleared by this app. Authorization URLs include account selection prompts so users can switch provider accounts during the next login.

## CI/CD Checks

Backend:

```bash
uv run --directory backend ruff check app tests
uv run --directory backend mypy
uv run --directory backend pytest -q
```

Frontend / Electron:

```bash
npm run typecheck
npm run build
```

Deployment pipeline:

1. Run checks.
2. Build backend image.
3. Push image.
4. Run Alembic migration.
5. Deploy backend.
6. Build and deploy web app.
7. Build and sign Electron installers.

## Operational Notes

- Use a managed secret store for production env vars.
- Rotate OAuth client secrets if exposed.
- Never commit `.env` with real secrets.
- Add observability before public launch: structured logs, request IDs, error tracking, uptime checks.
- Move one-time desktop login codes to Redis if backend runs many stateless replicas and database writes become too heavy. The current database-backed approach is correct and durable for this project stage.
