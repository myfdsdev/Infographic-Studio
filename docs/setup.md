# Local setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20.19 or newer | ESM, `--watch` and import attributes are used. |
| npm | 10 or newer | Workspaces are used for `client` and `server`. |
| MongoDB | 7.x or newer, optional locally | Local Community Server, Docker, Atlas, or the bundled development server (`npm run db:dev`). The API starts without it but reports `not_ready`. |

## 1. Install

```bash
npm install
```

This installs the root, client and server dependencies in one go.

## 2. Configure the server

```bash
cp server/.env.example server/.env
```

Then edit `server/.env`:

- `MONGODB_URI`: your connection string (see "Database" below).
- `MONGODB_DB_NAME`: defaults to `ai_infographic_studio`. It is used when the URI names no database. Keep this app in its **own** database; do not share one with another application.
- `SESSION_SECRET` and `ENCRYPTION_KEY`: generate each one with

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`ENCRYPTION_KEY` must be exactly 64 hex characters. Keep it safe: it encrypts users' Kie.ai keys, and changing it later makes stored keys unreadable. Users would then have to save their key again.

Provider and worker settings (`KIE_API_BASE_URL`, `WORKER_*`, `JOB_*`) have working defaults; see the comments in `server/.env.example`. Leave `PUBLIC_WEBHOOK_BASE_URL` empty locally.

There is no platform Kie.ai key to configure. Each user saves their own key in the app (strict BYOK).

Validate the result:

```bash
npm run check:env
```

The client needs no configuration for local development. `client/.env.example` documents the optional variables.

## 3. Database

Choose one:

- **Bundled development MongoDB (no install).** In a second terminal:

  ```bash
  DEV_MONGO_PORT=27027 npm run db:dev
  ```

  Then set `MONGODB_URI=mongodb://127.0.0.1:27027` in `server/.env`. Without `DEV_MONGO_PORT`, the script uses port 27017. The first run downloads a MongoDB binary once, and data is kept in `server/.mongo-data` (`DEV_MONGO_DATA_DIR` changes it). Stop it with Ctrl+C. This is for development only. (`.claude/launch.json` starts it the same way on port 27027.)
- **Local MongoDB Community Server**, or `mongod --dbpath <folder>`: `MONGODB_URI=mongodb://127.0.0.1:27017`.
- **Docker:** `docker run -d --name infographic-mongo -p 27017:27017 mongo:7`.
- **Atlas:** create a cluster, allow your IP, and paste the `mongodb+srv://` URI. If it names no database, `MONGODB_DB_NAME` is used.

Then create the indexes once:

```bash
npm run db:indexes
```

(Indexes are also ensured on every start.)

## 4. First administrator

Create your admin account once (see `docs/admin-setup.md`):

```bash
npm run admin:bootstrap -w server -- --email you@example.com --confirm-email you@example.com
```

Public sign-up never creates an admin.

## 5. Run

Start both the API and the client dev server:

```bash
npm run dev
```

- Client: http://localhost:5173 (Vite proxies `/api` to the server)
- API: http://localhost:5000/api/health and http://localhost:5000/api/ready

Run them separately with `npm run dev:server` and `npm run dev:client`.

## 6. Verify

```bash
curl -s http://localhost:5000/api/health
curl -s -i http://localhost:5000/api/ready
```

`/api/ready` answers `200 ready` only when MongoDB responds to a ping and storage is usable. Without MongoDB it answers `503 not_ready` and names the failing check. The server keeps retrying the connection every `MONGODB_RETRY_SECONDS`.

## 7. Tests and build

```bash
npm test          # server tests: each file starts its own throwaway MongoDB and a mock Kie.ai
npm run build     # production build of the client into client/dist
npm run preview   # serve the built client locally on http://localhost:4173
```

The first `npm test` downloads a MongoDB server binary once (cached). Tests never use `MONGODB_URI` from `.env`, never call the real Kie.ai and never spend credits. See `docs/test-results.md`.

## Adding your Kie.ai key

1. Sign in and open **API Settings** (sidebar, under Connections). The header badge shows whether a key is connected.
2. Paste the key from https://kie.ai/api-key and save it. The server checks it against your credit balance, which is free, and stores it encrypted.
3. **Test connection** repeats that check at any time. **Replace key** and remove do what they say.

Without a key, generation is refused (`NO_API_KEY`). With a key Kie.ai has rejected, it is refused as `API_KEY_INVALID`.

## Creating an infographic

1. Open **Create Infographic** (the start page).
2. Describe the topic in 10 to 2000 characters. Put any facts and figures you want shown into the topic, because the model is told not to invent statistics.
3. Choose a style (**Minimal**, **Corporate** or **Colorful**) and an aspect ratio (**1:1** square, **4:5** portrait or **9:16** vertical).
4. Generate. Each generation is one paid Z-Image task (PNG) on your Kie.ai account. Progress is shown live.
5. **My Generations** lists your history. A generation's page has a full-size view, **Download**, **Regenerate** (a new image with the same settings) and **Delete**.

## Trying the app without a Kie.ai key (mock)

`server/scripts/devMockKie.js` is a development-only stand-in for Kie.ai that returns placeholder PNGs, never real generations.

```bash
DEV_MOCK_KIE_PORT=5055 DEV_MOCK_KIE_KEY=<any test key of 16+ characters> node server/scripts/devMockKie.js
KIE_API_BASE_URL=http://127.0.0.1:5055 KIE_UPLOAD_BASE_URL=http://127.0.0.1:5055 npm run dev:server
npm run dev:client
```

Save the same test key in API Settings. Loopback `http` provider URLs are accepted outside production only.

## Live check with a real Kie.ai key (optional, costs credits)

`npm test` never calls the real Kie.ai. To check the live API once, use a designated test key (never your main key) and a spending limit.

1. Create `server/.env.live-test` (git-ignored):

   ```
   KIE_LIVE_TEST_API_KEY=your-test-key
   KIE_LIVE_TEST_MAX_CREDITS=20
   # optional: 1:1, 4:5 or 9:16 (default 4:5)
   KIE_LIVE_TEST_RATIO=4:5
   ```

2. Run it:

   ```bash
   npm run test:live-kie -w server
   ```

It reads the balance, generates **one** infographic exactly as the app does (same prompt builder, `z-image`, PNG), downloads and checks the result, and writes it to `server/storage/live-check-<time>.png`. Kie.ai does not publish per-task prices, so the spend is measured from the balance. For a hard cap, use a separate Kie.ai account funded with only the test budget. This check has **not** been run yet.

## Admin panel

After the owner admin is bootstrapped, **Admin Panel** appears in the sidebar under Administration. Its tabs are Overview, Users, Generations, Jobs, Failures, MCP, Provider, Access, Audit Logs, Operations and Branding. See `docs/admin-setup.md`.

Before a release, build the client and scan for secrets:

```bash
npm run build && npm run check:secrets -w server
```

## Sign in with Google (optional)

1. In Google Cloud Console, create an OAuth client of type Web application with the redirect URI `http://localhost:5173/api/auth/google/callback`.
2. Put its id and secret in `server/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Restart the API. The sign-in and sign-up pages then show **Continue with Google**, and Settings shows **Connect Google**.

Rules:

- A new Google account gets a regular user account without a password (only while sign-ups are open).
- An existing account with the same email is not taken over. Sign in with the password, then connect Google in Settings.
- An account made with Google can set a password in Settings. Google can be disconnected only from an account that has a password.

## Connecting an AI app (MCP)

Open **MCP Connection** in the app. It shows the MCP URL (`SERVER_URL/mcp`), whether cloud apps can reach it, the setup steps for each app, your connections and recent activity.

Locally, `SERVER_URL` is `http://localhost:5000`. Claude on the web and ChatGPT cannot reach that address and need a deployed HTTPS server. Claude Code on the same computer can:

```bash
claude mcp add --transport http ai-infographic-studio http://localhost:5000/mcp
```

Then run `/mcp` inside Claude Code, choose the server, and approve on the consent page that opens. Remove it with `claude mcp remove ai-infographic-studio`. See `docs/mcp-setup.md`.

## Using an S3 or R2 bucket

Local development works without a bucket (`STORAGE_DRIVER=local`, files under `STORAGE_LOCAL_DIR`). To use one:

1. Create a **new, empty bucket only for AI Infographic Studio** and an API token limited to that bucket. On Cloudflare R2, the token permission is "Object Read & Write", applied to this bucket only.
2. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT` (R2: `https://<account-id>.r2.cloudflarestorage.com`), `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Keep the bucket private.
3. Check it:

   ```bash
   npm run test:live-storage -w server
   ```

The check stops without writing if the bucket already contains another application's files. The server applies the same rule and reports it in `/api/ready`.

**Sharing a bucket with another app** has to be a deliberate choice. Set `STORAGE_ALLOW_SHARED_BUCKET=true` and `STORAGE_KEY_PREFIX=infographic-studio/`. Every file of this app then lives under that folder, and the storage layer refuses to write or delete any key outside it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server exits with `Invalid environment configuration` | A required variable is missing or malformed. The message lists each one; compare with `server/.env.example`. |
| `/api/ready` returns 503 with the database disconnected | MongoDB is not reachable at `MONGODB_URI`. Start it (for example `npm run db:dev`) or fix the URI. The server reconnects automatically. |
| `EADDRINUSE` on start | Another process uses `PORT`, or another MongoDB uses the dev port. Change `PORT` (and `VITE_DEV_API_PROXY`) or `DEV_MONGO_PORT`. |
| Browser shows "The API is not reachable" | The server is not running, or the Vite proxy target differs from `PORT`. |
| CORS error in the browser | The page origin is not `CLIENT_URL` and not listed in `CORS_ORIGINS`. |
| "Connect your own Kie.ai API key" / `NO_API_KEY` | No key saved for this account. Add it in API Settings. |
| `API_KEY_INVALID` or "Kie.ai rejected this API key" | The key is wrong or was revoked at Kie.ai. Copy it again from the Kie.ai API key page. |
| Key status "not verified" | Kie.ai was unreachable when you saved. Press **Test connection** later. |
| Infographic failed with `SUBMISSION_UNCERTAIN` | The answer from Kie.ai was lost after sending. Check the task logs in your Kie.ai dashboard before regenerating: if the image was made there, generating again charges twice. |
| Infographic failed with `INSUFFICIENT_CREDITS` | Your Kie.ai account has no credits left. |
| Infographic failed with `RESULT_DOWNLOAD_FAILED` | The finished image could not be fetched from Kie.ai (it may have expired). Regenerate. |
| Infographics stay "Queued" | `WORKER_ENABLED=false`, the server is not running, or an admin paused generation. The worker starts after MongoDB connects. |
