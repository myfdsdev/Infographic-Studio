# Deployment

**Status:** AI Infographic Studio has **not** been deployed to production yet. It can be deployed as a static client plus a Node API, or as one Node service. No Dockerfile or platform manifest is committed.

## Build artefacts

```bash
npm ci
npm run build      # -> client/dist (static files)
npm start          # -> runs server/src/server.js
```

The server never needs a build step; it runs the ESM sources directly on Node 20.19+. No native media tools (such as ffmpeg) are required.

**Link previews:** set `VITE_SITE_URL` to the app's public address (for example `https://app.example.com`, no trailing slash) before `npm run build`. This makes the `og:` and `twitter:` URLs in `index.html` absolute, so shared links show the preview image (`client/public/branding/og-image.jpg`), title and description. Previews only appear for a public HTTPS address.

## Topologies

### A. Single service (API serves the client)

Set `SERVE_CLIENT=true` on the API. Express serves `client/dist` with an SPA fallback and a Content Security Policy, and keeps `/api/*`, `/mcp`, `/oauth/*` and `/.well-known/*` for the API. This is the simplest option for Render, Railway, Fly.io or a VM.

### B. Static host + API host

Deploy `client/dist` to a static host and the server separately.

- **Recommended:** let the static host rewrite `/api/*` to the API, and leave `VITE_API_BASE_URL` at `/api`. The browser then only talks to the static site's own address, and the session cookie stays first-party.
- **Alternatively:** set `VITE_API_BASE_URL` at build time to the API's public `/api` URL, and set `CLIENT_URL` on the API to the static site's origin. Two different sites (for example two `*.onrender.com` subdomains) make the session cookie third-party, which Safari and iOS block.

Example on Render with two services:
- **Backend (Web Service):** root `server/`, build `npm install`, start `npm start`, with `SERVE_CLIENT=false` and `CLIENT_URL` / `SERVER_URL` set to the two public addresses.
- **Frontend (Static Site):** build `npm ci && npm run build` from the repository root, publish `client/dist`. Add two rewrite rules in this order: `/api/*` to `<backend>/api/*`, then `/*` to `/index.html`.

For MCP, `SERVER_URL` must be the backend's public HTTPS address, so that `/mcp`, `/oauth/*` and `/.well-known/*` are reached directly.

### C. Reverse proxy

Put nginx or Caddy in front of both. Route `/api/*`, `/mcp`, `/oauth/*` and `/.well-known/*` to the Node process and everything else to the static files. Set `TRUST_PROXY` to the number of proxy hops (usually `1`).

`TRUST_PROXY` must match the real number of proxies in front of the app. Then per-IP rate limits see the client's address, and a forged `X-Forwarded-For` is ignored. Measure it on your platform. Requests that arrive through a static-site rewrite carry the rewrite proxy's address, so per-IP limits for that traffic are shared.

## Required production environment

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT`, `HOST` | As assigned by the platform (`HOST=0.0.0.0`). |
| `TRUST_PROXY` | The number of proxy hops in front of the API. |
| `CLIENT_URL`, `SERVER_URL` | Public HTTPS origins. `SERVER_URL` must be https while `MCP_ENABLED=true` (enforced). |
| `MONGODB_URI`, `MONGODB_DB_NAME` | A managed MongoDB (for example Atlas) with a user limited to this app's database. The default name is `ai_infographic_studio`; do not reuse another application's database. |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | Unique per environment, stored in the platform's secret manager. Back up `ENCRYPTION_KEY`: losing it makes every stored user key unreadable. |
| `EMAIL_PROVIDER` | `smtp` with `SMTP_*` set (enforced in production, so reset links are delivered). |
| `KIE_API_BASE_URL` | `https://api.kie.ai` (https is enforced in production). |
| `KIE_UPLOAD_BASE_URL` | `https://kieai.redpandaai.co` (https is enforced). Infographics are generated from text alone, so this is used only for jobs that reference a stored image. |
| `PUBLIC_WEBHOOK_BASE_URL` | Public https URL of the API. It enables Kie.ai callbacks that reconcile uncertain submissions. Optional but recommended. |
| `WORKER_ENABLED` | `true` on the instances that should process jobs. |
| `STORAGE_DRIVER` | `s3` (`local` is refused in production). |
| `S3_*` | A bucket dedicated to AI Infographic Studio and a token scoped to that bucket only. `S3_PUBLIC_BASE_URL` is not needed. Check the bucket with `npm run test:live-storage -w server`, which writes one test file under `infographic-studio-selftest/` and deletes it. |
| `STORAGE_KEY_PREFIX`, `STORAGE_ALLOW_SHARED_BUCKET` | The app refuses to write into a bucket that holds another application's files unless `STORAGE_ALLOW_SHARED_BUCKET=true`. That setting requires `STORAGE_KEY_PREFIX` (for example `infographic-studio/`), and every write and delete outside the prefix is refused. |
| `UPLOAD_MAX_MB`, `ASSET_DOWNLOAD_MAX_MB` | Defaults 10 (branding uploads) and 30 (largest generated image accepted). |
| `LOG_LEVEL` | `info` |

There is no platform Kie.ai key **variable**: an administrator saves the platform key in the app (Admin > Provider), where it is encrypted with `ENCRYPTION_KEY`. Without it, every user generates on their own key.

Validate before the first start:

```bash
npm run check:env
```

## MCP server and OAuth

- `SERVER_URL` must be the public HTTPS origin of the API. It is the OAuth issuer, and the MCP URL is `SERVER_URL/mcp`.
- Claude (web, desktop, mobile) and ChatGPT connect from their own servers. The MCP endpoint, `/.well-known/*` and `/oauth/*` must therefore be reachable from the internet, and a WAF in front of them must not block those clients.
- Behind a proxy, forward `/mcp`, `/oauth/*` and `/.well-known/*` unchanged:
  - do not buffer responses on `/mcp` (Server-Sent Events);
  - allow `application/x-www-form-urlencoded` bodies on `/oauth/token`.

  The OAuth server builds its endpoint URLs from `SERVER_URL`, whatever the request host.
- The consent page lives on `CLIENT_URL/connect/approve`, so `CLIENT_URL` must be the address users actually sign in on.
- Every API instance shares the OAuth store in MongoDB (`oauth_*` collections). The signing key is created once in `AppSettings`, encrypted with `ENCRYPTION_KEY`.
- Token lifetimes, registration methods and rate limits are described in `server/.env.example` and `docs/mcp-setup.md`.

## Sign in with Google (optional)

1. In Google Cloud Console, set up the OAuth consent screen with the `email`, `profile` and `openid` scopes. Publish it, or add test users while it is in testing.
2. Create an OAuth client ID of type Web application. The authorized redirect URI is the address the browser uses for the API plus `/api/auth/google/callback`. Locally that is `http://localhost:5173/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the API service, never in `VITE_*`. The redirect URI is built from `CLIENT_URL`; set `GOOGLE_REDIRECT_URI` only when the browser reaches the API on another address.
4. Redeploy the API.

## Health checks

- Liveness: `GET /api/health` (200 while the process is up).
- Readiness: `GET /api/ready` (200 only when MongoDB and storage are usable, 503 otherwise).

Point platform health checks at `/api/ready`.

## Process management

- The background worker runs inside the API process (`WORKER_ENABLED=true`). Jobs live in MongoDB and are claimed with a lease, so several instances can run the worker without sending a job twice. Set `WORKER_ENABLED=false` on instances that should only serve HTTP.
- The same worker saves finished infographic images into storage. Each record is claimed first, so instances never store the same image twice.
- `WORKER_CONCURRENCY` limits jobs per instance and `JOB_USER_CONCURRENCY` limits running jobs per user. Administrators can change both at runtime under **Admin Panel > Access**.
- After a crash or deploy, jobs whose lease expired are picked up again. A job that was in the middle of sending is never resent: it waits for the provider callback, then fails as `SUBMISSION_UNCERTAIN`.
- The server shuts down cleanly on `SIGTERM`/`SIGINT`: it stops the worker, stops accepting connections, closes MongoDB and exits.
- Logs are JSON on stdout in production.

## Database

- Create the application user with `readWrite` on the AI Infographic Studio database only.
- Indexes are ensured on every start. `npm run db:indexes` does the same on demand.
- Enable backups (Atlas continuous backup, or `mongodump` on a schedule).
- `npm run db:dev` is a development convenience only. Never use it in production.

## Object storage

Any S3-compatible bucket works (Cloudflare R2, AWS S3, MinIO).

- Keep the bucket **private**. No public access, CORS rule or CDN is needed: the API streams images to their owner (`GET /api/infographics/:id/image`, `Cross-Origin-Resource-Policy: same-site`). The client and API must therefore share a site, so images load with the session cookie.
- Branding images (logo, favicon) are stored under `branding/` and served publicly by the API at `GET /api/branding/logo|favicon`.
- Use an access token scoped to this bucket only.

## Step by step: one Node service (topology A)

1. **MongoDB:** create a database and a user with `readWrite` on it only.
2. **Bucket:** create a private bucket and a token scoped to it.
3. **SMTP:** an account that can send from your domain, for password-reset emails.
4. **Secrets:** generate `SESSION_SECRET` and `ENCRYPTION_KEY` (run the command once for each) and keep them in the platform's secret manager.

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Environment** (in the platform settings, never committed):
   - `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT`, `TRUST_PROXY`;
   - `SERVE_CLIENT=true`, with `CLIENT_URL` and `SERVER_URL` set to the same public `https://` origin;
   - `MONGODB_URI` (and `MONGODB_DB_NAME` if needed), `SESSION_SECRET`, `ENCRYPTION_KEY`;
   - `EMAIL_PROVIDER=smtp` and `SMTP_*`;
   - `STORAGE_DRIVER=s3` and `S3_*`;
   - `KIE_API_BASE_URL=https://api.kie.ai`;
   - `PUBLIC_WEBHOOK_BASE_URL` set to the same origin;
   - `WORKER_ENABLED=true`.
6. **Build and start:** build with `npm ci && npm run build`, start with `npm start`.
7. **Health check:** `GET /api/ready`.
8. **First deploy:** run `npm run check:env` and `npm run db:indexes`. Then bootstrap the owner admin once with `npm run admin:bootstrap -w server -- --email ... --confirm-email ...` (see `docs/admin-setup.md`), and remove `ADMIN_PASSWORD` if you set it.
9. **Check:**
   - `/api/ready` returns 200, and `/api/branding` returns the AI Infographic Studio defaults.
   - Sign in, save a Kie.ai key, and generate one infographic.
   - Open **MCP Connection**: the URL must start with `https://` and cloud apps must be reported as able to reach it.
   - Add the connector in Claude or ChatGPT (see `docs/mcp-setup.md`).
   - Run `npm run check:secrets -w server` on the build machine.

## Not yet verified

- A production start with real SMTP, S3 and MongoDB values.
- A real infographic generated with a real Kie.ai key.
- A live Claude or ChatGPT connection over public HTTPS.
- A Docker image (none is provided).

## Checklist before go-live

- [ ] `npm run check:env` passes with production values
- [ ] `/api/ready` returns 200 from the deployed URL
- [ ] HTTPS enforced at the proxy or platform
- [ ] `ENCRYPTION_KEY` backed up in a secret manager
- [ ] MongoDB is this app's own database, with backups enabled
- [ ] The bucket is dedicated to this app (or deliberately shared with `STORAGE_KEY_PREFIX`) and private
- [ ] Owner admin bootstrapped once, `ADMIN_PASSWORD` removed afterwards
- [ ] `PUBLIC_WEBHOOK_BASE_URL` set to the public API URL, and `/api/webhooks/*` reachable from the internet
- [ ] SMTP verified (`/api/ready` shows email delivering to inboxes)
- [ ] `SERVER_URL` is the public `https://` origin; `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server` load from outside
- [ ] **Admin Panel > Access** reviewed (sign-ups, concurrency) and **Branding** checked
- [ ] `npm run check:secrets -w server` passes on the built client
- [ ] One live infographic made with a designated test key (`npm run test:live-kie -w server`)
