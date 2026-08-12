# Deploying Games to Railway

Games is a single Railway service (web + API) plus a Postgres database.

## 1. Create the Railway project

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** and pick this repo.
3. **Add → Database → PostgreSQL** in the same project. Railway injects
   `DATABASE_URL` into the service automatically. The schema is created on first
   boot (idempotent `CREATE TABLE IF NOT EXISTS`).

`railway.json` already configures the build (`npm install --include=dev && npm
run build`), start (`npm start`), and health check (`/healthz`). Node is pinned
to 24 via `.nvmrc` and `engines`.

## 2. Custom domain

In the Railway service → **Settings → Networking → Custom Domain**, add
`games.iambrian.com` and point its DNS `CNAME` at the Railway target.

## 3. Google OAuth

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID → Web application**.
2. **Authorized redirect URIs** — add both:
   - `https://games.iambrian.com/api/auth/google/callback` (production)
   - `http://127.0.0.1:4567/api/auth/google/callback` (local dev)
3. Copy the client ID/secret into Railway service **Variables**:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - (optional) `GOOGLE_REDIRECT_URI=https://games.iambrian.com/api/auth/google/callback`
     to pin the URI instead of deriving it from the request host.
   - (optional) `GAMES_ALLOWED_EMAILS=a@x.com,b@y.com` to restrict sign-in.

`NODE_ENV=production` (Railway sets this) makes session cookies `Secure`. The app
sets `trust proxy` so `req.protocol` is `https` behind Railway's proxy — required
for the redirect URI and secure cookies.

## 4. Deploy

Railway builds and deploys on push. Visit the domain, sign in with Google, create
a game, and invite players (by search or by sharing the join code / `/join/<code>`
link). The app is installable as a PWA from the browser's "Add to Home Screen".

## Environment variables summary

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Provided by the Railway Postgres plugin. |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth web client. |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth web client. |
| `GOOGLE_REDIRECT_URI` | no | Pin the OAuth callback URL. |
| `GAMES_ALLOWED_EMAILS` | no | Comma-separated sign-in allowlist. |
| `PORT` | no | Set by Railway; defaults to 1010 locally. |
