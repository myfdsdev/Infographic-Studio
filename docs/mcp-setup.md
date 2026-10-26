# MCP setup

**Status (2026-10-17):** implemented and covered by automated protocol tests. These use the official MCP SDK client plus HTTP-level tests against the real server code, with a mock Kie.ai. **No real Claude, Claude Code or ChatGPT connection has been tested yet** (see "Testing" below).

AI Infographic Studio runs its own remote MCP server and OAuth 2.1 authorization server inside the Express API. AI assistants can generate infographics and read the user's history through it. Every generation runs on the user's **own** Kie.ai key (strict BYOK).

## Endpoints

| URL | What |
|---|---|
| `SERVER_URL/mcp` | MCP over Streamable HTTP. Every request needs `Authorization: Bearer <access token>`. |
| `SERVER_URL/.well-known/oauth-protected-resource/mcp` (also at the root path) | RFC 9728 protected resource metadata: `resource`, `authorization_servers`, `scopes_supported`. |
| `SERVER_URL/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` | RFC 8414 / OIDC discovery for the authorization server (issuer = `SERVER_URL`). |
| `SERVER_URL/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`, `/oauth/jwks` | Authorization server endpoints. |
| `CLIENT_URL/connect/approve?uid=...` | Consent page, for signed-in users. |

The URL users paste into their AI app is exactly `SERVER_URL/mcp`. It is shown on the **MCP Connection** page (`/mcp`) in the app.

## Versions and standards

- MCP protocol **2026-07-28**, served with the official TypeScript SDK **v2** (`@modelcontextprotocol/server`, `@modelcontextprotocol/express`, `@modelcontextprotocol/node`). Clients on 2025-era protocol revisions are served through the SDK's stateless fallback. One `McpServer` is built per request, for that request's user.
- Server identity: name `ai-infographic-studio`. The title is the branding app name (default "AI Infographic Studio").
- Authorization server: **oidc-provider** (maintained and OpenID-certified), configured as described below.

## How authorization works

1. **Discovery.** The AI app calls `/mcp` without a token and gets `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`. That metadata names the authorization server.
2. **Registration.** One of:
   - **Client ID Metadata Documents (CIMD).** The client id is an https URL, and the server fetches it with oidc-provider's SSRF-guarded fetch.
   - **Dynamic Client Registration (RFC 7591)**, as a fallback. It is rate-limited to 30 per hour per IP. Registered clients without an approved connection are deleted after 7 days.

   `OAUTH_CIMD_ENABLED` and `OAUTH_DCR_ENABLED` switch each one.
3. **Authorization.** The app opens `/oauth/authorize` in the browser:
   - PKCE with `S256` is required for every client.
   - `resource` must be the MCP URL.
   - Redirect URIs must match exactly. The exception is loopback addresses (`localhost`, `127.0.0.1`, `[::1]`), which match on any port; Claude Code needs this.
   - Plain `http` is only accepted for loopback.
   - A client that requests no MCP scope is offered both scopes. The user still chooses.
4. **Consent** at `CLIENT_URL/connect/approve`:
   - The signed-in web session decides which account is connected. Users who are not signed in log in first.
   - The page shows the app name, who published its identity (the CIMD host) or that it registered itself (DCR), and the host the browser returns to. It warns when the app only uses localhost redirects.
   - The user can untick a permission, including the paid one. Every authorization request asks again.
5. **Return.** Approval sends the browser back through the authorization server. The server checks that the request was started in the same browser, then returns `code`, `state` and `iss` (RFC 9207).
6. **Tokens.** The app exchanges the code at `/oauth/token`:
   - Access tokens are opaque, last `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (default 60 minutes), and their only audience is the MCP URL.
   - Refresh tokens rotate on every use, and reusing an old one revokes the whole connection.
   - A connection unused for `OAUTH_REFRESH_TOKEN_TTL_DAYS` (default 30) ends, and every connection ends after 365 days at most.
7. **Every MCP request** checks that the token exists and has not expired, that its audience is exactly this MCP URL, that its connection is still active, and that the account is active. Session cookies do not work on `/mcp`, and MCP tokens do not work on `/api`.

Access tokens, refresh tokens and authorization codes are stored only as SHA-256 hashes. The signing key, used only if a client asks for `openid`, is stored encrypted with `ENCRYPTION_KEY`.

## Scopes

| Scope | Allows | Spends credits |
|---|---|---|
| `infographics:read` | `get_generation_status`, `list_infographics`, `get_infographic` | No |
| `infographics:write` | `generate_infographic` | Yes: each call is a paid generation on the user's own Kie.ai account |

A tool call without its scope gets `HTTP 403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"`, which is the MCP step-up challenge. Each tool also checks the scope again before running.

## Tools

All tools call the same `infographic.service.js` as the dashboard, as the token's user. Ownership, validation, duplicate protection and strict BYOK are therefore identical. Inputs are strict: unknown fields are refused. Results are JSON (`structuredContent` plus a text copy).

| Tool | Input | What it does |
|---|---|---|
| `generate_infographic` | `topic` (10-400 chars), `layout` (optional: `auto` \| `list` \| `steps` \| `timeline` \| `comparison` \| `pros_cons` \| `statistics` \| `cycle` \| `mindmap`), `style` (`minimal` \| `corporate` \| `colorful` \| `dark` \| `pastel` \| `sketch` \| `isometric` \| `retro` \| `gradient`), `aspect_ratio` (`1:1` \| `3:4` \| `9:16`), `confirm_paid_generation: true` (required), `idempotency_key` (optional, 8-60 letters, digits, `-`, `_`) | Starts one infographic and returns at once with `infographic_id`, the details, `deduplicated`, a `charges` note and `next_steps`. |
| `get_generation_status` | `infographic_id` | `status`, `finished`, `message`, image info when ready (width, height, type, size, `download_url`), error, `web_url`, `next_step`. |
| `list_infographics` | `status` (`all` \| `active` \| `completed` \| `failed` \| `cancelled`), `page`, `limit` (1-50, default 20) | The user's history, newest first, with `web_url` per item. |
| `get_infographic` | `infographic_id` | Full details: topic, style, ratio, model, source, status, progress, image info, error, `regenerated_from`, `web_url`. |

`generate_infographic` refuses before anything is created when:
- generation is paused by an admin;
- the user has no Kie.ai key (`NO_API_KEY`);
- the saved key was rejected (`API_KEY_INVALID`).

The usual flow is to call it once, then call `get_generation_status` every 15-30 seconds until `finished` is true. Generations usually finish in under two minutes.

Duplicate protection: a retried call with the same `idempotency_key` returns the same infographic and is not charged twice. Without a key, identical calls from the same connection within about two minutes map to the same generation.

Images are stored privately. `web_url` (`CLIENT_URL/generations/<id>`) and `download_url` (`/api/infographics/<id>/image?download=1`) work in a browser that is signed in to the same account. Tool results never carry public file URLs or provider keys.

The MCP server's `instructions` tell the assistant to describe the generation and get the user's agreement before setting `confirm_paid_generation`.

## Connecting an AI app

Cloud apps (Claude on the web, desktop and mobile; ChatGPT) connect from their own servers, so `SERVER_URL` must be a **public HTTPS** address. A localhost server can only be used by apps on the same computer, such as Claude Code. The **MCP Connection** page reports whether cloud apps can reach the server.

- **Claude:**
  1. Go to **Customize > Connectors > Add custom connector**. On Team and Enterprise plans, an Owner uses Organization settings.
  2. Paste the URL and leave the OAuth client fields empty.
  3. Choose **Add**, then **Connect**, and approve on the consent page.
  4. Enable the connector in a chat.
- **Claude Code:** run `claude mcp add --transport http ai-infographic-studio <SERVER_URL>/mcp`, then `/mcp` inside Claude Code to authenticate in the browser. Remove it with `claude mcp remove ai-infographic-studio`.
- **ChatGPT:** needs developer mode. Create an app with the URL and OAuth. ChatGPT's CIMD client authentication (`private_key_jwt`) is supported. Menus change, so follow OpenAI's current help article.
- **Other MCP apps:** add a remote Streamable HTTP server with the URL. Sign-in is discovered automatically.

## Managing connections

The **MCP Connection** page lists every approved connection: the app and its identity, the return host, the approved permissions, and when it was approved and last used (with the last tool). **Revoke** ends a connection at once.

Connections are also revoked when:
- the user changes or resets their password;
- the app revokes its own refresh token (RFC 7009);
- a reused refresh token is detected;
- an admin revokes it;
- the account is deleted.

Suspending an account blocks every token while the suspension lasts. Administrators see all connections, tool usage and recent tool failures under **Admin Panel > MCP**, and can turn AI-app access off under **Access**.

## Audit log

The admin audit log has an `mcp` area, which is also shown to the user as recent activity. It records:
- approvals, denials and revocations;
- one entry per tool call: the tool, outcome, error code, connection, app name, duration and sanitized arguments.

Arguments keep ids and choices, while free text (`topic`) is reduced to its length. Tokens, keys and prompts are never written.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SERVER_URL` | `http://localhost:5000` | Public base URL. The MCP URL is `SERVER_URL/mcp` and the issuer is `SERVER_URL`. Must be https in production while MCP is enabled. |
| `CLIENT_URL` | `http://localhost:5173` | Where the consent page and the `web_url` links live. |
| `MCP_ENABLED` | `true` | Turns the MCP and OAuth endpoints off when `false`. |
| `OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` | Access token lifetime. |
| `OAUTH_REFRESH_TOKEN_TTL_DAYS` | `30` | A connection unused this long ends. |
| `OAUTH_CIMD_ENABLED`, `OAUTH_DCR_ENABLED` | `true` | Client registration methods. |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | Requests per minute per access token. |

## Testing

**Automated protocol tests** run with `npm test`:

- `tests/integration/mcpAuth.test.js` covers:
  - discovery documents and the `401` challenge;
  - the full flow with DCR, PKCE, consent, code, tokens and tools;
  - S256-only PKCE and exact redirect matching;
  - consent deny and browser binding;
  - narrowed consent with the `insufficient_scope` challenge;
  - refresh rotation and reuse detection;
  - revocation by the user and by the client;
  - password change, suspension and account deletion;
  - CIMD with loopback ports, and a ChatGPT-style CIMD client with `private_key_jwt`;
  - hashed token storage, sanitized audit, and the MCP Connection page data.
- `tests/integration/mcpTools.test.js` covers:
  - exactly the four tools listed;
  - `generate_infographic` on the user's own key, tracked with `get_generation_status`;
  - the paid confirmation and input validation;
  - strict BYOK (no key or a rejected key starts nothing);
  - idempotent retries;
  - isolation between users;
  - read-only connections;
  - audit entries with the topic reduced to its length.
- `tests/integration/mcpClientSdk.test.js` runs the **official MCP SDK client** over real HTTP:
  - the 2025-era handshake and the 2026-07-28 protocol;
  - CIMD with a random loopback port;
  - refusal after a revoke.

**Live client tests have not been done.** No real Claude, Claude Code or ChatGPT connection has been made. Claude and ChatGPT need a deployed public HTTPS `SERVER_URL`, while Claude Code can be tried locally. After a live test, record the result in `docs/test-results.md` and update `CLIENT_VERIFICATION` in `server/src/services/mcpConnection.service.js`. It drives the per-app status on the MCP Connection page and is currently `not_tested` for every app.

## Known limits

- Claude's and ChatGPT's handling of the `insufficient_scope` step-up challenge has not been observed. A user who unticked the paid permission may have to reconnect to add it.
- Client ID Metadata Document support in oidc-provider is marked experimental (draft-02).
- There are no MCP tools for regenerating or deleting an infographic. Those actions stay in the web app.
- Tool results link to images that need the web session; the image bytes are not returned through MCP.
