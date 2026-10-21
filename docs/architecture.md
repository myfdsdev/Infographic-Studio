# Architecture

AI Infographic Studio is a standalone MERN application. It has four parts:

- a React (Vite) client;
- an Express API;
- MongoDB through Mongoose;
- a background worker that runs inside the API process.

The application has one feature: it turns a topic into an infographic image with Kie.ai Z-Image, on the requesting user's **own** Kie.ai key. An OAuth-protected MCP server exposes the same feature to AI clients, and an admin panel operates the platform.

## System overview

```
Browser (React)                         AI client (Claude, ChatGPT, Claude Code, ...)
        |  HTTPS /api/*                          |  MCP (Streamable HTTP) + OAuth 2.1
        v                                        v
+------------------------------ Express API --------------------------------+
| routes -> validators -> controllers -> services -> models (Mongoose)       |
|                                  |                                         |
|   services/infographic.service.js  <---- mcp/tools.js (same service)       |
|                                  |                                         |
|   services/job.service.js (strict BYOK)  jobs/* (queue, worker, recovery)  |
|   providers/kie/* (direct Kie.ai HTTP calls)                               |
+----------------------------------------------------------------------------+
        |                      |                              |
     MongoDB          Object storage (local / S3)        Kie.ai API
```

## Layers and rules

| Layer | Location | Responsibility |
|---|---|---|
| Client services | `client/src/services/*` | The only place the browser makes HTTP calls. They call this backend only. |
| Routes | `server/src/routes/*` | Wire URLs to controllers, with per-route middleware (auth, admin, rate limit, validation). |
| Validators | `server/src/validators/*` | Request schemas (zod). Unknown fields are rejected. |
| Controllers | `server/src/controllers/*` | HTTP concerns only. |
| Services | `server/src/services/*` | Business logic and **ownership checks**, shared by controllers, MCP tools and the worker. |
| Providers | `server/src/providers/*` | The Kie.ai adapter: HTTP client, model table, status normalisation. `providerRegistry.js` is the only entry point. |
| Jobs | `server/src/jobs/*` | Durable queue in MongoDB, the in-process worker, and stale-job recovery. |
| MCP | `server/src/mcp/*` | The OAuth authorization server, the MCP endpoint and its tools. |
| Models | `server/src/models/*` | Mongoose schemas and indexes. |

Rules:

- The browser never talks to Kie.ai or to the storage bucket.
- Strict BYOK. Every generation uses the requesting user's own key. There is no shared, platform or admin key.
- Provider keys are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`, bound to the user and provider). After saving, a key is never returned to any client, admins included.
- Admin authorisation is enforced in the backend (`requireAdmin`), never by hiding UI.
- The acting user always comes from the session or the OAuth grant, never from a request body.
- File bytes live in storage. MongoDB holds only their metadata (`Asset`).

## Request lifecycle

1. `pino-http` assigns a request id and logs the request, with secrets redacted.
2. `helmet` adds security headers. `cors` applies the allow-list (`CLIENT_URL`, `SERVER_URL`, `CORS_ORIGINS`), and JSON bodies are parsed.
3. The MCP, OAuth and discovery routes are mounted **before** this CORS allow-list and the body parsers (see MCP below).
4. The `/api` router sits behind the general rate limiter (`RATE_LIMIT_*`); health endpoints are exempt.
5. Every error reaches `errorHandler`, which emits `{ error: { code, message, details?, requestId } }`.

The server starts even when MongoDB is unreachable and retries the connection every `MONGODB_RETRY_SECONDS`. `/api/ready` reports the real state.

## Data model

The default database name is `ai_infographic_studio`. It is used when `MONGODB_URI` names no database, and it is deliberately separate from any other application's database.

| Model | Purpose |
|---|---|
| `User` | Account, scrypt password hash (or Google-only sign-in), role (`user`/`admin`), status, suspension reason. |
| `Session` | Opaque session tokens. Only an HMAC is stored, with expiry and revocation reason. |
| `PasswordResetToken` | HMAC of single-use, expiring reset tokens. |
| `ApiCredential` | One encrypted provider key per user and provider, with the last 4 characters, status (`valid`/`unverified`/`invalid`) and last balance. |
| `GenerationJob` | Durable provider job: kind (`image`), model, provider-ready request, status and phase, provider task id, attempts, lease, timeouts, result, error, event log, idempotency key and input hash. Infographic jobs have `subjectType: 'infographic'`. |
| `Infographic` | One request and its result: owner, topic, title (first sentence of the topic), style, aspect ratio, model, full prompt, source (`web` or `mcp`), `regeneratedFrom`, `jobId`, status, stored image (asset id, width, height, type, size), error, and a save claim. |
| `Asset` | Metadata of a stored file: owner, purpose (`infographic_image`), source, storage driver and private key, type, size, dimensions, hash. |
| `McpConnection` | One approved AI app per row: user, client id and name, registration type, return host, OAuth grant id, scopes, status, last use and last tool. |
| OAuth store (`oauth_*` collections) | oidc-provider artefacts: grants, hashed tokens and codes, interactions, registered clients. TTL indexes clean them up. |
| `AuditLog` | Who did what and when: auth, account, key, infographic, admin and MCP actions. Secrets are scrubbed. |
| `AppSettings` | Key-value settings: the one-time owner bootstrap marker, `platform` (access switches, concurrency, turned-off models), `branding`, and the encrypted OAuth signing key. |
| `OpsLog` | Server warnings and errors for the admin Operations page, redacted, kept 14 days (TTL). |

## Infographic pipeline

```
POST /api/infographics  (or MCP generate_infographic)
  -> infographic.service.createInfographic
       validate topic (10-2000 chars), style, aspect ratio
       buildInfographicPrompt()                       services/infographicPrompt.js
       job.service.createJob(kind image, model z-image,
                             aspect ratio, resolution 2K, output png)
         assertGenerationAllowed / assertModelEnabled  (admin switches)
         assertUsableKey  -> NO_API_KEY | API_KEY_INVALID (nothing is created)
         idempotency key / identical active request in the last 2 min -> existing job
       Infographic { status: queued, jobId }
  -> worker: submit to Kie.ai with the owner's key, poll until done
  -> worker step processInfographics():
       claim the record, download the finished image (safe fetch, size-capped,
       falls back to Kie.ai's download-url endpoint), check it is a real image,
       store it as a private Asset (purpose infographic_image),
       mark the Infographic completed (or failed / cancelled with the job's error)
```

- **Prompt builder** (`services/infographicPrompt.js`). The user's topic (control characters stripped, whitespace collapsed) is wrapped in fixed instructions:
  - **composition:** a title, clearly separated sections with icons, a grid, short readable text, correct spelling;
  - **format hint:** describes the chosen shape;
  - **style directive:** `minimal`, `corporate` or `colorful`;
  - **accuracy rules:** use only what the topic states or implies, or widely accepted general knowledge, and **never invent statistics**, percentages, numbers, dates, quotes, sources, brand names or scientific claims;
  - **avoid list:** real people's photos, logos, watermarks, placeholder text, gibberish, clutter, cut-off text.
- **Model and output.** `z-image`, PNG (the model has no resolution setting). All three offered ratios (1:1, 3:4, 9:16) are native Z-Image `aspect_ratio` values, so the shape is sent as a parameter. The prompt only repeats it as a composition hint. Z-Image accepts at most 1000 prompt characters, so the fixed instructions are compact and topics are capped at 400 characters. Records made earlier at 4:5 stay valid and regenerate as 3:4.
- **Regenerate** creates a **new** infographic with the same topic, style and ratio (`regeneratedFrom` points at the original). The original is kept.
- **Delete** is refused while the infographic is queued or processing (`409 INFOGRAPHIC_ACTIVE`). Otherwise the record is removed, and its stored image is removed when nothing else uses it.
- **Saving the image** is claimed per record (`saving.claimedUntil`), so two workers never store it twice. A failed save is retried up to 3 times, then the infographic fails with the reason (for example `RESULT_DOWNLOAD_FAILED`, `RESULT_TOO_LARGE`). A key rejected while downloading (`PROVIDER_KEY_REJECTED`) fails at once.
- The dashboard routes and the MCP tools both call `infographic.service.js`, so validation, ownership, BYOK and duplicate protection are identical.

## Generation jobs

All provider work goes through `GenerationJob` and the shared state machine in `jobs/handlers/providerTask.js`:

```
pending_submit --write "submitting" first--> createTask --taskId--> polling --success--> completed
      ^                                         |                     '--fail-------> failed
      '-- certainly not created (429, 455,      |
          refused connection): backoff,         '-- unknown outcome (timeout, 5xx, no taskId)
          at most JOB_MAX_ATTEMPTS                    --> reconcile --verified callback--> polling
                                                                    '--deadline--> failed SUBMISSION_UNCERTAIN
```

- **Strict BYOK.** `job.service.assertUsableKey` refuses before anything is queued: `400 NO_API_KEY` when the user has no key, and `400 API_KEY_INVALID` when Kie.ai rejected the saved key. At run time the worker decrypts the owner's key in memory. A key rejected by Kie.ai fails the job (`PROVIDER_KEY_REJECTED`) and marks the key `invalid`.
- **Provider adapter.** `providers/kie/` holds the HTTP client, the image model table (`capabilities.js`: Nano Banana 2, Nano Banana Edit, Grok Imagine Image 2.0 and its Edit variant, Z-Image) and status normalisation. Only Z-Image is used by the product. The others are image models kept in the catalogue, and admins can turn any of them off.
- **Claiming.** `jobs/queue.js` claims one due job atomically with a lease (`lockedBy` / `lockedUntil`). Only the lease holder can release it.
- **No duplicate charges.** Before `createTask`, the job is written as phase `submitting`. Any answer that does not prove the task was *not* created moves the job to `reconcile`, never back to sending. A retry of such a job needs explicit confirmation.
- **Reconciliation.** When `PUBLIC_WEBHOOK_BASE_URL` is set, each submission carries a callback URL with a per-job token. A callback is accepted only after the task is fetched from Kie.ai with the owner's key and its callback URL matches this job.
- **Polling, timeouts, concurrency.** Polling backs off from `JOB_POLL_MIN_MS` to `JOB_POLL_MAX_MS`. Each job has a deadline: queue allowance plus `JOB_IMAGE_TIMEOUT_MINUTES`. `WORKER_CONCURRENCY` caps jobs per process and `JOB_USER_CONCURRENCY` caps jobs per user; admins can override both at runtime.
- **Duplicate submissions.** An `Idempotency-Key` (unique per user), or an identical active request from the last two minutes, returns the existing job and infographic.
- **Restart recovery.** `jobs/recovery.js` runs when the worker starts and every minute after. A job stuck in `submitting` goes to `reconcile`. Any other job with an expired lease continues where it stopped. The same timer removes stored images that nothing references.

## Storage

- `storage.service` writes files under random keys: `users/<id>/<purpose>/<yyyy-mm>/<random>.<ext>`, inside `STORAGE_KEY_PREFIX` when one is set. Nothing is served statically.
- `GET /api/infographics/:id/image` and `GET /api/assets/:id/content` stream a file to its owner only.
- Drivers: `local` (development only) and `s3`, for any S3-compatible service such as Cloudflare R2.
- Before the first write, and in `/api/ready`, the bucket's top level is checked. If it holds anything other than this app's own folders, writes are refused (`STORAGE_NOT_DEDICATED`). Sharing a bucket deliberately needs `STORAGE_ALLOW_SHARED_BUCKET=true` plus `STORAGE_KEY_PREFIX`; the driver then refuses any key outside the prefix.
- Generated images are fetched with `utils/safeFetch.js`:
  - https only;
  - public addresses only, re-checked on every redirect;
  - size capped by `ASSET_DOWNLOAD_MAX_MB` and time capped.

  `utils/imageInspect.js` checks the type from the bytes and strips metadata.
- Branding images (logo, favicon) are the only uploads. They go through `multer` (in memory, `UPLOAD_MAX_MB`) and the same image checks.

## MCP and OAuth

```
AI app --401--> PRM (/.well-known/oauth-protected-resource/mcp) --> AS metadata (/.well-known/oauth-authorization-server)
       --CIMD or DCR--> /oauth/authorize --303--> CLIENT_URL/connect/approve (web session, consent)
       --/api/oauth/interactions/:uid/approve--> resume (same browser) --code+iss--> app
       --/oauth/token (PKCE, resource)--> opaque access token (aud = SERVER_URL/mcp) + rotating refresh token
       --Bearer--> /mcp --> tokenVerifier --> McpServer (per request) --> tools --> infographic.service
```

- `mcp/oauthServer.js` configures **oidc-provider** as the authorization server:
  - authorization code flow only, PKCE S256 required;
  - RFC 8707 resource indicators, so the only audience is the MCP URL;
  - Client ID Metadata Documents plus Dynamic Client Registration;
  - refresh-token rotation;
  - the RFC 9207 `iss` parameter;
  - loopback redirects on any port for native clients.

  It has no login form of its own: every request goes to the consent page.
- `mcp/oauthStore.js` is the MongoDB adapter. Bearer artefacts are stored as SHA-256 hashes, and DCR clients without an approved connection expire after 7 days. `mcp/oauthKeys.js` keeps one signing key, encrypted.
- `mcp/http.js` mounts discovery, the rate-limited OAuth routes and `/mcp`. The `/mcp` chain:
  1. open CORS without credentials;
  2. a loopback Host check when `SERVER_URL` is a loopback host;
  3. a per-token rate limit (`MCP_RATE_LIMIT_PER_MINUTE`);
  4. a database check;
  5. the admin "AI apps" switch;
  6. `requireBearerAuth` with `mcp/tokenVerifier.js`, which checks audience, connection status and account status on every request.
- `mcp/server.js` builds one SDK v2 `McpServer` per request (server name `ai-infographic-studio`, title = branding app name) with instructions that describe the paid flow.
- `mcp/tools.js` registers four tools (catalogue in `mcp/toolCatalog.js`, scopes in `mcp/scopes.js`):

  | Tool | Scope | Paid |
  |---|---|---|
  | `generate_infographic` | `infographics:write` | yes, requires `confirm_paid_generation: true` |
  | `get_generation_status` | `infographics:read` | no |
  | `list_infographics` | `infographics:read` | no |
  | `get_infographic` | `infographics:read` | no |

  Each tool:
  - declares a scope challenge (HTTP 403 `insufficient_scope`) and re-checks the scope before running;
  - runs as the token's user;
  - writes an audit entry, with free text reduced to its length.
- `services/mcpConnection.service.js` handles consent (approve, narrow, deny), connections, revocation and activity. A connection is revoked by the user, an admin, the client itself, a password change or reset, or account deletion.

## Frontend

- Vite + React 19 and React Router 7. Bootstrap 5 is used only as a utility base (grid, spacing).
- The **Soft Modern White** design system lives in `client/src/styles/style.css`:
  - surfaces `#FFFFFF` / `#F8FAFC`;
  - accent `#7665E8`, with `#6E5CE6` for button fills and `#5F4DD6` for accent text so contrast passes WCAG AA;
  - soft tints `#F1EEFF`, `#E8F7F1`, `#FFF2EA`;
  - border `#E9ECF2`;
  - text `#202338` and `#64748B`;
  - Plus Jakarta Sans (self-hosted), 12-16px radii;
  - one light theme, no dark mode.
- `AppLayout` has a left sidebar (`Sidebar.jsx`) and a top header (`Topbar.jsx`). The header shows the page title and the user's Kie.ai key status (connected, not verified, missing, rejected), which links to API Settings. Sidebar groups:
  - **Workspace:** Create Infographic, My Generations
  - **Connections:** API Settings, MCP Connection
  - **Account:** Settings
  - **Administration:** Admin Panel (admins only)
- Pages (`client/src/pages`):

  | Page | Contents |
  |---|---|
  | `CreateInfographic.jsx` | Topic, style and ratio pickers, generate. |
  | `MyGenerations.jsx` | History with status filter. |
  | `GenerationDetails.jsx` | Live progress, image, download, regenerate, delete. |
  | `ApiSettings.jsx` | Connect, test, replace or remove the Kie.ai key. |
  | `McpConnection.jsx` | MCP URL, per-app setup, connections, activity. |
  | `ConnectConsent.jsx` | OAuth consent at `/connect/approve`. |
  | `AccountSettings.jsx` | Profile, password, Google, sessions, delete account. |
  | `auth/*` | Sign-in, sign-up and password reset. |

- Admin pages (`client/src/pages/admin`, horizontal tabs in `AdminLayout`): Overview, Users and User details, Generations, Jobs, Failures, MCP (monitor and connections), Provider, Access, Audit Logs, Operations, Branding.
- `services/api.js` is the single fetch wrapper (credentials included, timeouts, normalised `ApiError`). `BrandingContext` loads the public branding.

## Admin controls and branding

- `services/platformSettings.service.js` holds the `platform` settings. They are cached for 5 seconds per process and enforced on the server:
  - sign-ups;
  - maintenance mode (administrators are exempt);
  - pausing generation (new infographics, jobs and retries are refused; queued jobs wait);
  - access for AI apps (`/mcp` and consent);
  - concurrency per user and per worker process;
  - turned-off models, which are refused with `MODEL_DISABLED`.
- `services/adminOps.service.js` provides:
  - statistics, including infographic totals by status, source and style;
  - system health;
  - failure groups with redacted messages;
  - the cross-user infographic list (no prompts);
  - the MCP monitor (connections, tool calls and failures per tool);
  - the operations log, AI connections and the provider model catalogue.
- `config/opsLog.js` copies the logger's already-redacted warnings, errors and 5xx request logs into `OpsLog`.
- `services/branding.service.js` and the public `/api/branding` routes serve the name, tagline, accent colour, logo and favicon. Defaults: "AI Infographic Studio", "Turn any topic into a clear, professional infographic", `#7665e8`. Emails and the MCP server title use the app name.
- With `SERVE_CLIENT=true`, client pages get a Content Security Policy (scripts from this origin only). API, OAuth and MCP responses do not carry it.

## Removed from the earlier codebase

The project was derived from an earlier codebase. The following were removed and do not exist in this one:

- the earlier product's content features and their routes;
- user photo uploads and MCP upload links;
- admin template management;
- ffmpeg media processing;
- audio and non-image provider models;
- the System Status page.

The job engine, authentication, OAuth/MCP plumbing, storage and admin foundation were kept.
