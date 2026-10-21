# Tests

## Running the tests

```bash
npm test                 # from the repository root (runs the server suites)
npm test -w server       # the same
node --test server/tests/integration/infographics.test.js   # one file
```

- Runner: Node's built-in `node:test`, two files at a time (`--test-concurrency=2`).
- Database: each file starts its own throwaway MongoDB through `mongodb-memory-server`. The binary is downloaded once and cached. `MONGODB_URI` from `.env` is never used.
- Provider: a mock Kie.ai (`tests/fixtures/mockKie.js`) runs on a local port and serves placeholder images. Tests **never** call the real Kie.ai and never spend credits.
- Other fixtures: a mock S3 (`mockS3.js`), a mock Google sign-in (`mockGoogle.js`), an OAuth flow helper (`oauthFlow.js`) and test images (`images.js`).

## Latest result

**203 of 203 tests pass** as of 2026-10-17 (24 files: 17 integration, 7 security).

## What the suites cover

### Integration (`server/tests/integration`)

| File | Tests | Covers |
|---|---|---|
| `infographics.test.js` | 12 | Options (3 styles, 3 ratios). End-to-end generation on the user's own key, saved privately and downloadable. Validation before any provider call. Strict BYOK (no key or a rejected key blocks generation; keys are never shared). Provider failure. A key rejected at the provider. An unreadable result retried, then reported. Regenerate and history order. Idempotency key. Owner-only read, download, regenerate and delete. No delete while active. Account deletion removes infographics and images. |
| `mcpTools.test.js` | 8 | Exactly the four tools. `generate_infographic` on the user's own key, tracked by `get_generation_status`. Paid confirmation and input validation. Strict BYOK. Idempotent retries. User isolation. Read-only connections cannot generate. Audit with the topic reduced to its length. |
| `mcpAuth.test.js` | 14 | Discovery metadata and challenges. Full OAuth flow (DCR, PKCE, consent, tokens, tools). S256-only PKCE and exact redirects. Consent deny and browser binding. Narrowed consent and `insufficient_scope`. Refresh rotation and reuse detection. Revocation by the user and by the client. Password change, suspension and deletion. CIMD with loopback ports and with `private_key_jwt`. Hashed tokens and sanitized audit. MCP Connection page data. |
| `mcpClientSdk.test.js` | 4 | The official MCP SDK client over real HTTP: the 2025-era handshake, the 2026-07-28 protocol, CIMD with a random loopback port, and refusal after a revoke. |
| `jobs.test.js` | 20 | Job lifecycle; key and model checks; idempotency and double-submit collapse; bounded backoff on rate limits; rejected keys, no credits and invalid input; uncertain submissions never resent and retry confirmation; restart recovery; per-user concurrency; two workers never submitting twice; timeouts; cancelling; owner scoping; admin job routes with prompt preview only. |
| `jobsCallback.test.js` | 6 | Callback URL per job, genuine callback reconciliation without resubmission, wrong tokens ignored, token masked in logs. |
| `credentials.test.js` | 13 | Saving (verified without generating, encrypted, last 4 only), rejected and malformed keys, provider outage (`unverified`), revoked keys, replace and delete, owner scoping, ciphertexts bound to their user, admin view without key digits, no key in logs, Bearer-only delivery to the provider, account deletion. |
| `adminPlatform.test.js` | 13 | Admin endpoints refused to non-admins; real statistics; access switches (sign-ups, maintenance with admins still allowed in, AI apps off); pausing and resuming generation; per-user concurrency setting applied by the worker; turning a model off; generation monitoring; MCP monitoring; branding; admin revocation of AI connections (user details never include keys); grouped and redacted failures; the operational log. |
| `adminUsers.test.js` | 7 | User search (literal, case-insensitive), filters and pagination without password hashes, user details, statistics, audit log search and filters without secrets. |
| `auth.test.js` | 14 | Sign-up (never admin, cookie flags, public fields only), scrypt hashes, HMAC session tokens, duplicate and weak input, generic login errors, remember-me, server-side logout, forged cookies, CSRF origin check, audit entries, Google button hidden without credentials. |
| `googleAuth.test.js` | 12 | Sign in with Google: PKCE and state, new and returning users, account linking rules, error redirects. |
| `passwordReset.test.js` | 7 | Identical responses for known and unknown emails, HMAC tokens, single use, expiry, session revocation. |
| `bootstrap.test.js` | 6 | One-time owner bootstrap rules, promotion of an existing account, `--keep-password`. |
| `health.test.js` | 10 | `/api/health`, `/api/ready`, 503 when the database is down, `GET /api` endpoint list. |
| `s3Storage.test.js` | 5 | Infographics stored privately in an S3-compatible bucket (mock), owner-only reads, deletion, outage handling. |
| `s3SharedBucket.test.js` | 5 | Shared-bucket mode with `STORAGE_KEY_PREFIX`: configuration rules and writes and deletes confined to the prefix. |
| `secrets.test.js` | 1 | Real flows with debug logging leak no secret into logs or responses. |

### Security (`server/tests/security`)

| File | Tests | Covers |
|---|---|---|
| `adminAccess.test.js` | 10 | 401/403 on every admin route for anonymous users and non-admins; privileged fields refused at sign-up, login and account updates; no self role or status change; role changes effective on the next request; last admin cannot delete themself; strict admin validation. |
| `isolation.test.js` | 8 | Users only ever see their own data; malformed ids are rejected. |
| `suspension.test.js` | 7 | Suspension cuts sessions, sign-in, reset links and AI-app access. |
| `actAs.test.js` | 6 | "Act as user" is read-only, has eligibility rules, and expires. |
| `encryption.test.js` | 6 | AES-256-GCM round trip, random IV, AAD binding to user and provider, tamper detection. |
| `imageInspect.test.js` | 7 | Type from bytes, dimensions, metadata stripping. |
| `rateLimit.test.js` | 2 | Per-account and per-IP login throttling. |

## Not tested

- **Real Kie.ai.** No infographic has been generated with a real Kie.ai key; every generation in the tests uses the mock. The opt-in live check `npm run test:live-kie -w server` (one paid infographic, see `docs/setup.md`) has not been run.
- **Real external MCP clients.** No live connection from Claude, ChatGPT or Claude Code has been made. The MCP tests use the official SDK client and HTTP-level tests against the local server only. A live test with Claude or ChatGPT needs a public HTTPS deployment. `CLIENT_VERIFICATION` in `server/src/services/mcpConnection.service.js` is `not_tested` for every app.
- **Production deployment.** No production start with real MongoDB, S3 and SMTP values.
- **Browser end-to-end tests.** There is no automated browser test suite.

When a live check is done, record the date, what was run and the outcome here.
