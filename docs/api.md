# API reference

Base path: `/api`. All responses are JSON unless noted (image routes stream bytes). Errors share one shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route GET /api/nope not found",
    "details": null,
    "requestId": "7e1b3c7d-..."
  }
}
```

`details` is present only when a validator or service attaches structured information. In non-production environments, 5xx responses also include the first lines of the stack trace.

Common error codes:

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `CORS_NOT_ALLOWED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` / `DUPLICATE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `DATABASE_UNAVAILABLE`, `SERVICE_UNAVAILABLE` |

`GET /api` returns the service name, version and the list of mounted endpoints.

## Conventions

- **Authentication.** A successful signup or login sets the `iv_session` cookie (httpOnly, SameSite=Lax, `Secure` in production). Every route marked "signed in" needs it. The account's status is re-checked on every request, so a suspended account gets `403 ACCOUNT_SUSPENDED` even with an old cookie.
- **CSRF.** Browsers can only call the API from origins in `CLIENT_URL` / `CORS_ORIGINS`; other origins get `403 CORS_NOT_ALLOWED`. Together with SameSite cookies, this is the CSRF defence.
- **Validation.** Request bodies are strict: unknown fields cause `400 VALIDATION_ERROR`. Fields such as `role`, `status` or `email` sent where they are not accepted are rejected, not ignored.
- **Rate limits.** All limits are reported with `RateLimit-*` headers.

  | Applies to | Limit |
  |---|---|
  | Every `/api` route except health and image reads (infographic images, branding logo/favicon) | `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` per IP (default 1000 per 15 minutes) |
  | Signup, login and reset requests | `AUTH_RATE_LIMIT_MAX` per IP, plus `LOGIN_EMAIL_RATE_LIMIT_MAX` per account |
  | Password change, account deletion, key save/test | The auth limiter |
  | New infographics, regenerations and jobs | `JOB_CREATE_RATE_LIMIT_PER_MINUTE` per user |

- **Database down.** Routes that need MongoDB answer `503 DATABASE_UNAVAILABLE` instead of hanging.
- **Admin switches.** When generation is paused, new infographics, regenerations, jobs and retries get `503 GENERATION_PAUSED`. In maintenance mode, every signed-in route except sign-out answers `503 MAINTENANCE` for non-admins. A turned-off model gives `400 MODEL_DISABLED`.

## Health

| Method and path | Access | Result |
|---|---|---|
| `GET /api/health` | public | Liveness. Always `200` while the process is up (`service: infographic-studio-api`, version, environment, uptime). |
| `GET /api/ready` | public | `200 ready` or `503 not_ready` with the same body: `checks.database`, `checks.storage` and `checks.email`. Email is reported but never required. |

## Authentication (`/api/auth`)

| Method and path | Access | Body | Result |
|---|---|---|---|
| `POST /signup` | public | `{ name, email, password }` | `201 { user }`, session cookie set. New accounts are always role `user`. `409` if the email exists, `403 SIGNUP_DISABLED` when sign-ups are closed. |
| `POST /login` | public | `{ email, password, remember? }` | `{ user }`, session cookie set. A wrong email and a wrong password give the same `401`. Suspended accounts get `403 ACCOUNT_SUSPENDED`. |
| `POST /logout` | signed in | none | `{ ok: true }`, session revoked and cookie cleared. |
| `GET /me` | signed in | none | `{ user, actingAs }`. `actingAs` is `null`, or describes the administrator while "Act as user" is active. |
| `POST /act-as/stop` | signed in | none | Ends "Act as user": `{ user, actingAs: null, viewedUserId }`. `409 NOT_ACTING_AS` when no view is active. |
| `GET /options` | public | none | `{ google, signupEnabled }`. |
| `GET /google/start?returnTo=` | browser navigation | none | Starts Sign in with Google (PKCE, signed flow cookie `iv_google`). `returnTo` must be a path inside the app. |
| `GET /google/connect` | signed in, browser navigation | none | Connects Google to the signed-in account. |
| `GET /google/callback` | from Google | `code`, `state` | Verifies the flow and the ID token, then signs in, creates a password-less user (only while sign-ups are open), or links the account. Failures redirect with `?google=` (`cancelled`, `expired`, `failed`, `unverified_email`, `email_in_use`, `signup_disabled`, `suspended`, `maintenance`, `already_linked`, `not_signed_in`). An existing account with the same email is never taken over. |
| `POST /forgot-password` | public | `{ email }` | Always the same `{ ok, message }`. Sends a single-use link valid for `PASSWORD_RESET_TTL_MINUTES`. |
| `POST /reset-password` | public | `{ token, password }` | `{ ok, message }`. Revokes every session and every AI-app connection of the account. |

Passwords need 8 to 128 characters with at least one letter and one number. `user` objects contain `id, email, name, role, status, createdAt, lastLoginAt`, never hashes or tokens.

## Account (`/api/settings`, signed in)

| Method and path | Body | Result |
|---|---|---|
| `GET /account` | none | `{ user, signIn: { hasPassword, google: { available, connected, email } } }` |
| `PATCH /account` | `{ name }` | `{ user }`. Only the display name can change here. |
| `POST /account/password` | `{ currentPassword, newPassword }` (Google-only accounts: `{ newPassword }` once) | `{ ok }`. Other sessions and all AI-app connections are revoked; this session stays. |
| `POST /account/delete` | `{ password }` (Google-only accounts: `{ confirmEmail }`) | `{ ok }`. Deletes the account with its sessions, reset tokens, encrypted keys, jobs, infographics, AI connections and every stored image. The last active admin cannot delete themself. |
| `POST /account/google/disconnect` | none | `{ ok }`. `409 PASSWORD_REQUIRED` without a password, `409 GOOGLE_NOT_CONNECTED`. |
| `GET /sessions` | none | `{ items }`, with `current: true` on this session. |
| `DELETE /sessions/:id` | none | `{ ok }`. Revokes one of your own sessions. |
| `POST /sessions/revoke-others` | none | `{ ok, revoked }` |

## Provider keys (`/api/settings`, signed in)

Keys are encrypted with AES-256-GCM (`ENCRYPTION_KEY`, bound to the user and provider) and never returned. Responses carry only the last four characters. There is no shared or admin key: each user generates with their own key.

| Method and path | Body | Result |
|---|---|---|
| `GET /providers` | none | `{ items: [{ key, name, description, website, docs, keyPage, models }] }` (image models only). |
| `GET /credentials` | none | `{ items: [credential] }` |
| `PUT /credentials/:provider` | `{ apiKey }` | Add or replace. The key is first checked with Kie.ai's free balance endpoint, never with a generation. Returns `{ credential, verification: { ok, balance, error } }`. A key Kie.ai rejects is **not** saved (`400 KEY_REJECTED`). If Kie.ai is unreachable, the key is saved as `unverified`. |
| `POST /credentials/:provider/verify` | none | Tests the connection again: `{ credential, verification }`. A key revoked at Kie.ai becomes `invalid`. `409 KEY_UNREADABLE` if the stored ciphertext cannot be decrypted (for example after `ENCRYPTION_KEY` changed). |
| `DELETE /credentials/:provider` | none | `{ ok }`, or `404` when no key is stored. |

`credential` has the shape `{ provider, last4, status: valid | unverified | invalid, lastVerifiedAt, lastCheckError, balance, balanceCheckedAt, createdAt, updatedAt }`. Supported provider: `kie` (Kie.ai).

## Infographics (`/api/infographics`, signed in)

Every route acts on the caller's own infographics only. Another user's id answers `404`.

| Method and path | Body / query | Result |
|---|---|---|
| `GET /options` | none | `{ styles: [{ id, label, summary }], aspectRatios: [{ id, label }], topic: { min: 10, max: 2000 }, model: { id: "z-image", label } }` |
| `GET /` | `?status=all\|active\|queued\|processing\|completed\|failed\|cancelled&page=&limit=` (limit 1-100, default 24) | `{ items, total, page, limit, pages }`, newest first. |
| `POST /` | `{ topic, style, aspectRatio, idempotencyKey? }` | `202 { infographic, deduplicated: false }` for a new generation. `200 { infographic, deduplicated: true }` when the same idempotency key was used before, or an identical request is still active from the last two minutes. |
| `GET /:id` | none | `{ infographic }`, with live `progress` while it runs. |
| `POST /:id/regenerate` | `{ idempotencyKey? }` | A **new** infographic with the same topic, layout, style and ratio (`regeneratedFrom` set): `202` (or `200` when deduplicated). |
| `GET /:id/image` | `?download=1` | The PNG bytes, owner only. `Content-Disposition: inline`, or `attachment; filename="<title-slug>-<id-suffix>.png"` with `download=1`. `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`. `404 IMAGE_NOT_READY` before completion. |
| `DELETE /:id` | none | `{ ok: true }`. Removes the record and its stored image. `409 INFOGRAPHIC_ACTIVE` while queued or processing. |

Body rules:

- `topic`: 10 to 400 characters after trimming. Control characters are removed and whitespace is collapsed.
- `layout`: optional content structure, `auto` (default), `list`, `steps`, `timeline`, `comparison`, `pros_cons`, `statistics`, `cycle` or `mindmap`.
- `style`: `minimal`, `corporate`, `colorful`, `dark`, `pastel`, `sketch`, `isometric`, `retro` or `gradient`.
- `aspectRatio`: `1:1`, `3:4` or `9:16`.
- `idempotencyKey`: optional, 8 to 100 characters from letters, digits, `-` and `_`. An `Idempotency-Key` header in the same format is also accepted.

Unknown fields are rejected.

Example:

```json
{ "topic": "5 benefits of AI automation for small businesses", "layout": "list", "style": "corporate", "aspectRatio": "3:4" }
```

Every generation runs `z-image` (PNG output; prompt capped at 1000 characters, so topics at 400) on the caller's own Kie.ai key. Aspect ratios are 1:1, 3:4 and 9:16; older 4:5 records regenerate as 3:4. Errors raised before anything is created:

| Code | Meaning |
|---|---|
| `400 NO_API_KEY` | The caller has not saved a Kie.ai key. |
| `400 API_KEY_INVALID` | Kie.ai rejected the saved key. Replace it in API Settings. |
| `400 VALIDATION_ERROR` | Short topic, unknown layout or style, or unsupported ratio. |
| `503 GENERATION_PAUSED`, `400 MODEL_DISABLED` | Admin switches. |
| `429` | Over `JOB_CREATE_RATE_LIMIT_PER_MINUTE`. |

`infographic` object:

```json
{
  "id": "6ad0...",
  "title": "5 benefits of AI automation for small businesses",
  "topic": "5 benefits of AI automation for small businesses",
  "layout": "list",
  "style": "corporate",
  "aspectRatio": "3:4",
  "model": "z-image",
  "source": "web",
  "status": "completed",
  "progress": null,
  "image": { "url": "/api/infographics/6ad0.../image", "width": 0, "height": 0, "mimeType": "image/png", "size": 0 },
  "error": null,
  "jobId": "6ad0...",
  "regeneratedFrom": null,
  "createdAt": "...", "updatedAt": "...", "completedAt": "..."
}
```

- `status` is `queued`, `processing`, `completed`, `failed` or `cancelled`.
- `source` is `web` or `mcp`.
- `progress` is `{ phase, message, providerState }` while active.
- `error` is `{ code, message }`. Codes include the job failure codes below, plus `RESULT_MISSING`, `RESULT_DOWNLOAD_FAILED`, `RESULT_TOO_LARGE` (above `ASSET_DOWNLOAD_MAX_MB`) and `RESULT_SAVE_FAILED` when a finished image could not be stored after 3 attempts.
- `title` is the first sentence of the topic, at most 100 characters.
- `image` values in the example are placeholders. Width, height and size are measured from the stored file.

## Generation jobs (`/api/jobs`, signed in)

Infographics are built on these jobs. The routes stay available for inspecting, cancelling and retrying jobs, and for low-level image jobs.

| Method and path | Result |
|---|---|
| `POST /api/jobs` | Body `{ kind: "image", provider?, model, prompt?, aspectRatio?, resolution?, outputFormat?, referenceImageUrls? (public https only), idempotencyKey? }`. Queues one image job on the caller's own key. `202 { job, deduplicated }`, `200` when deduplicated. Same `NO_API_KEY` / `API_KEY_INVALID` rules. |
| `GET /api/jobs?status=&kind=&page=&limit=` | `{ items, total, page, limit }`, newest first, own jobs only. |
| `GET /api/jobs/:id` | `{ job }`. `404` for another user's job. |
| `POST /api/jobs/:id/cancel` | `{ job }`. If the job was not yet sent, it is cancelled and nothing is charged. If it was already sent, polling stops; Kie.ai may still finish and charge. `409` for a finished job. |
| `POST /api/jobs/:id/retry` | Body `{ confirmDuplicateRisk? }`. Creates a new job (`retryOf` set), `202 { job }`. Answers `409 CONFIRMATION_REQUIRED` unless `confirmDuplicateRisk: true` when the first request may have reached Kie.ai. |

The job object includes `id, kind, provider, model, status, phase, message, providerTaskId, providerState, submitAttempts, pollCount, submissionUncertain, result { urls, creditsConsumed, costTimeSeconds }, error, canCancel, canRetry, retryNeedsConfirmation, retryOf, request, timestamps, events`.

Job failure codes:

| Code | Meaning |
|---|---|
| `NO_API_KEY`, `KEY_UNREADABLE` | No usable key at run time. |
| `PROVIDER_KEY_REJECTED` | Kie.ai refused the key. The saved key is marked `invalid`. Not retried. |
| `INSUFFICIENT_CREDITS` | The Kie.ai account has no credits. Not retried. |
| `INVALID_REQUEST`, `MODEL_DISABLED` | Kie.ai refused the input or the model. Not retried. |
| `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` | Retried with backoff up to `JOB_MAX_ATTEMPTS`; Kie.ai certainly did not create a task on these answers. |
| `SUBMISSION_UNCERTAIN` | The request may have reached Kie.ai (timeout, dropped connection, 5xx, reply without a task id). It is **never resent automatically**, and retrying needs confirmation. |
| `PROVIDER_GENERATION_FAILED` | Kie.ai ran the task and it failed; its message is included. |
| `TASK_NOT_FOUND` | Kie.ai no longer knows the task. |
| `TIMEOUT` | No result within `JOB_IMAGE_TIMEOUT_MINUTES` (after the queue allowance). Kie.ai may still finish and charge. |
| `CANCELLED` | Cancelled by the user or an admin. |

## Stored files (`/api/assets`, signed in)

| Method and path | Result |
|---|---|
| `GET /api/assets/:id/content` | The file bytes, owner only (`404` for anyone else). Private caching, `nosniff`, `Cross-Origin-Resource-Policy: same-site`. Supports `Range` and `?download=1`. |
| `DELETE /api/assets/:id` | `{ ok }`. `409 ASSET_IN_USE` while an infographic or a running job uses it. |

Nothing under the storage folder or bucket is served publicly. Storage errors are `503 STORAGE_UNAVAILABLE` (no details returned) and `503 STORAGE_NOT_DEDICATED` (the bucket holds another application's files, so nothing is written).

## MCP Connection page (`/api/mcp`, signed in)

| Method and path | Result |
|---|---|
| `GET /info` | `enabled`, `available` (false while an admin turned AI apps off), `url` (`SERVER_URL/mcp`), `issuer`, `transport`, `protocol`, `authentication`, `registration { metadataDocument, dynamic }`, `reachability { https, publicHttps, cloudClients, localClients }`, `tokens { accessTokenMinutes, refreshTokenIdleDays, maxConnectionDays }`, `scopes`, `tools` (name, title, scopes, paid), `clientVerification` (live-test status per app, currently all `not_tested`). |
| `GET /connections` | `{ items }`: app name, client id, `publishedBy` (CIMD host), registration type, return hosts, scopes, status, created, last used and last tool, revoked date and reason. |
| `DELETE /connections/:id` | `{ connection }`. Revokes the grant and every token at once. `404` for another user's connection. |
| `GET /activity` | `{ items }`: the user's MCP audit entries (approvals, denials, revocations, tool calls with outcome). |

## Consent page (`/api/oauth`, signed in)

| Method and path | Result |
|---|---|
| `GET /interactions/:uid` | The pending authorization: the app (name, client id, `publishedBy`, registration, redirect host, `loopbackOnly`), offered scopes, signed-in account, expiry. `410 INTERACTION_EXPIRED`, `409 INTERACTION_DONE`. |
| `POST /interactions/:uid/approve` | Body `{ scopes: [...] }`, at least one of `infographics:read`, `infographics:write`. Creates the grant and the connection, and returns `{ redirectTo }` for the browser. |
| `POST /interactions/:uid/deny` | Returns `{ redirectTo }`; the app receives `access_denied`. |

## MCP and OAuth endpoints (outside `/api`)

See `docs/mcp-setup.md` for the flow and the tools.

| Endpoint | Notes |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` (and at the root path) | RFC 9728. `resource` is `SERVER_URL/mcp`; `scopes_supported` is `infographics:read`, `infographics:write`. |
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/openid-configuration` | Issuer `SERVER_URL`, `code_challenge_methods_supported: ["S256"]`, Client ID Metadata Document support, `authorization_response_iss_parameter_supported: true`. |
| `GET /oauth/authorize` | Code flow. PKCE S256 is required, and `resource` must be the MCP URL. Redirects to the consent page `CLIENT_URL/connect/approve`. |
| `POST /oauth/token` | Form-encoded. `authorization_code` and `refresh_token` grants; refresh tokens rotate. |
| `POST /oauth/register` | RFC 7591, rate-limited (30 per hour per IP). |
| `POST /oauth/revoke` | RFC 7009. A client may only revoke its own tokens. |
| `POST /mcp` | Streamable HTTP; `Authorization: Bearer` is required. Without a valid token: `401` with `resource_metadata`. A tool outside the granted scopes gets `403 insufficient_scope` with the needed `scope`. While AI apps are turned off: `503 temporarily_unavailable`. |

## Provider callbacks (`/api/webhooks`)

`POST /api/webhooks/:provider/:jobId/:token` is public and always answers `200 { ok: true }`. It is used only when `PUBLIC_WEBHOOK_BASE_URL` is set.

The payload is never trusted on its own. The task is fetched from Kie.ai with the job owner's key, and it must have been created with this job's callback URL. Only then is the task id attached, which is how an uncertain submission is reconciled without resending it. Tokens are stored hashed and masked in logs.

## Branding (`/api/branding`, public)

| Method and path | Result |
|---|---|
| `GET /` | `{ branding: { appName, tagline, accentColor, logoPath, faviconPath, customLogo, customFavicon, version } }` |
| `GET /logo`, `GET /favicon` | The uploaded image (`404` when none). Versioned URLs are cached long and `immutable`. `Content-Security-Policy: default-src 'none'`. |

## Admin (`/api/admin`, admin role)

Every route requires an active administrator. Non-admins get `403`, and signed-out callers get `401`. Every change is audited.

| Method and path | Result |
|---|---|
| `GET /stats` | `{ stats }`: user counts and `users` (new in 7 days, with a provider key), `jobs` (by status; created, completed and failed in 24 h), `infographics` (`total, completed, failed, cancelled, active, created24h, bySource, byStyle`), `keys` (counts only), `mcp` (active connections, tool calls and failures in 24 h), `storage` (files, bytes), `ops` (server errors in 24 h). |
| `GET /system` | `{ system }`: database (connected, name), worker (due jobs, oldest wait, concurrency, active infographics), storage driver, email, MCP (enabled, URL), access switches, process uptime and memory. |
| `GET /failures?days=1..30` | Failed jobs grouped by error code (count, latest, models, redacted example) plus recent failed jobs with user email. |
| `GET /ops-logs?level=&search=&page=&limit=` | Server warnings and errors of the last 14 days (redacted). |
| `GET /settings`, `PATCH /settings` | Body `{ access?: { signupEnabled, maintenanceMode, maintenanceMessage, generationEnabled, generationPausedMessage, mcpEnabled }, limits?: { userConcurrency 1-20, workerConcurrency 1-50 } }`. |
| `GET /providers` | Kie.ai hosts, key counts (saved, invalid), and every image model with `usedFor` (Z-Image: "Infographic generation"), `enabled` and failures in 24 h. |
| `PUT /providers/kie/models` | Body `{ model, enabled }`. A turned-off model is refused with `400 MODEL_DISABLED`. Turning off `z-image` stops infographic generation. |
| `GET /infographics?search=&status=&page=&limit=` | Every user's infographics, newest first: `{ items: [{ id, userId, userEmail, title, style, aspectRatio, source, status, error (redacted), jobId, createdAt, completedAt }], total, page, limit }`. `search` matches an infographic, user or job id, a user email or the title. Prompts are never included. |
| `GET /mcp/monitor?days=1..30` | `{ monitor: { since, enabled, url, connections { active, revoked, total, lastUsedAt }, tools: [{ tool, calls, failures, lastAt }], recentFailures: [{ id, userEmail, tool, client, code, at }] } }` |
| `GET /mcp/connections?status=&search=&page=&limit=` | Every user's AI connections with `userEmail`. |
| `DELETE /mcp/connections/:id` | Revokes the connection and its tokens (`revokedReason: admin`). |
| `GET /branding`, `PUT /branding` | Body `{ appName?, tagline?, accentColor? (#rrggbb) }`. |
| `POST /branding/logo`, `POST /branding/favicon` | Multipart `file`: PNG, JPEG or WebP (no SVG), metadata removed. `201 { branding }`. |
| `DELETE /branding/logo`, `DELETE /branding/favicon`, `POST /branding/reset` | Back to the defaults. |
| `GET /users?search=&status=&role=&page=&limit=` | `{ items, total, page, limit }` |
| `GET /users/:id` | `{ user, activeSessions, recentActivity, credentials, mcpConnections, usage }`. `credentials` holds `{ provider, status, lastVerifiedAt, updatedAt }` only, never a key or its last digits. `usage` holds `{ infographics, infographicsCompleted, infographicsFailed, jobs, failedJobs }`. |
| `PATCH /users/:id` | Body `{ role?, status?, reason? }`. Suspending revokes every session and blocks AI-app tokens at once. Changes to your own account are refused, and so is removing the last active admin. |
| `POST /users/:id/act-as` | "Act as user": this browser session sees the app as that user, read-only, for up to 60 minutes. Writes are refused with `403 ACT_AS_READ_ONLY`, except `POST /api/auth/act-as/stop` and `POST /api/auth/logout`. Refused for yourself (`400 ACT_AS_SELF`), administrators (`403 ACT_AS_ADMIN`) and suspended accounts (`409 ACT_AS_SUSPENDED`). |
| `GET /audit-logs?search=&area=&outcome=&page=&limit=` | Areas `auth`, `account`, `admin`, `mcp`, `system`. |
| `GET /jobs?status=&kind=&search=&page=&limit=` | All users' jobs with `userEmail`. `request` carries a 120-character `promptPreview` only. |
| `POST /jobs/:id/retry`, `POST /jobs/:id/cancel` | Same rules as the user routes. |
