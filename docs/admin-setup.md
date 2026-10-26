# Admin setup

## Roles

- `user`: the default for every signup. A user manages their own account, sessions, Kie.ai key, infographics and AI connections.
- `admin`: everything a user can do, plus the admin area (`/admin/*` pages and `/api/admin/*` routes). The role lives on the `User` document, and `requireAdmin` checks it on every admin request. The UI never grants access by itself.

Public signup **never** creates an admin, including the very first account. `role`, `status` and `email` are rejected by the profile validator. They can only change through the admin service, which writes an `AuditLog` entry.

Administrators generate like everyone else: with credits while they have them, then with their own Kie.ai key. The **platform** Kie.ai key (Admin > Provider) pays only for credit-paid infographics; see [Credits and bonus links](#credits-and-bonus-links).

## Creating the owner admin (one time)

The bootstrap script promotes exactly one owner account. It refuses to run when an administrator already exists or when it has already completed (marker `owner_bootstrap` in `AppSettings`).

```bash
npm run admin:bootstrap -w server -- --email you@example.com --confirm-email you@example.com
```

- The email is typed twice to avoid promoting the wrong account. `--name "Your Name"` is optional.
- Password: taken from `ADMIN_PASSWORD` in `server/.env` if set; otherwise it is asked twice with hidden input. It needs at least 12 characters with letters and numbers. There is no default password.
- If the account does not exist, it is created as admin. If it exists, it is promoted, its password is replaced and its sessions are revoked.
- `--keep-password` promotes an existing account without changing its password. This is useful when you signed up normally first.
- The password is never printed. Remove `ADMIN_PASSWORD` from the environment after the run.

To check the result, sign in. The sidebar shows **Admin Panel** under Administration, and `/admin` opens it.

## Admin Panel

The Admin Panel (`/admin`) shows its sections as one row of tabs. Every page reads live data from `/api/admin/*`, and every change is checked on the server (`requireAdmin`) and written to the audit log.

| Tab | What it does |
|---|---|
| Overview | Generation usage: all-time results, success rate, the most used infographic types and styles, and how many were started through MCP. Also provider jobs and MCP activity in the last 24 hours, system health (MongoDB, storage, email delivery) and recent sign-ups. |
| Users | Search by name or email, filter by status and role, export CSV, open a user. |
| User details | Account facts, **credits** (add or remove, with a note, and the history), active sessions, usage (infographics, completed, failed, jobs), Kie.ai key **status only**, and AI connections with **Revoke**. Also recent activity, suspend or reactivate with a reason, and change role. You cannot change your own account, and the last active admin cannot be removed. Suspension ends sessions and blocks AI-app tokens at once. **Act as user** is described below. |
| Generations | Every user's infographics, newest first, with user email, title, style, ratio, source (web or MCP), status and redacted error. Search by email, title or id; filter by status. Prompts and keys are never shown. |
| Jobs | Every provider job across users, with filters, a prompt preview only, and cancel and retry. Retrying a job that may already have reached Kie.ai asks for confirmation. |
| Failures | Failed jobs of the last 1, 7 or 30 days, grouped by error code with counts, models, the latest time and an example message. Messages are redacted on the server; prompts are never shown. |
| MCP | Server status and URL, active connections, tool calls and failed calls per tool for a chosen range, recent tool failures, and every user's AI connections with **Revoke** (the app's tokens stop working on the next request). |
| Provider | The **platform Kie.ai key** (save, test, replace, remove; only its last 4 characters are shown). Kie.ai hosts, the number of saved user keys (and rejected ones), and every image model with its use and failures in the last 24 hours. Turning a model **off** refuses it in the API and in MCP tools. Turning off **Z-Image** stops all infographic generation. |
| Access | **Allow new sign-ups**. **Maintenance mode**: only administrators can sign in, while users and AI apps get the message. **Allow new generations**: when off, nothing new reaches Kie.ai and queued jobs wait. **Allow AI apps (MCP)**. **Credits per infographic** (default 10). **Jobs per user at the provider** (1 to 20) and **jobs per worker process** (1 to 50). Settings are saved in the database and applied within a few seconds by every API instance. |
| Audit Logs | Sign-ins, password, account, key, infographic, AI-connection and admin actions, filterable by area (including `mcp`) and outcome. Secrets are scrubbed before storage. |
| Operations | The running system (database, worker queue, storage, email, MCP, process) and the server's warnings and errors of the last 14 days, searchable, with context. Entries are copied after the logger's redaction and redacted again. Client errors (4xx) are not kept. |
| Bonus Links | Create sign-up links that give new accounts free credits, with an optional sign-up limit and expiry date. Copy a link, switch it on or off, and see its sign-ups and the credits given. See below. |
| Branding | App name, tagline, accent colour, logo and favicon, with a live preview. See below. |

## Credits and bonus links

1. **Save the platform key.** Admin > Provider > **Platform Kie.ai key**. It is checked with a free balance call, then encrypted with `ENCRYPTION_KEY`. Without it, credits cannot be spent and everyone generates on their own key, exactly as before.
2. **Set the price.** Admin > Access > **Credits per infographic** (default 10). It applies to new generations.
3. **Give credits.** Create a bonus link in Admin > **Bonus Links**, or add credits to one account in its User details. New accounts start with 0 credits.

A bonus link looks like `CLIENT_URL/signup?bonus=<code>`. Only an account **created** through it (email or Google sign-up) gets the credits, once. An expired, switched-off or fully claimed link still lets people sign up, without credits. The sign-up limit is enforced atomically, so it holds under simultaneous sign-ups.

Credits are reserved when a generation starts and refunded once if it fails or is cancelled. Every change is in the user's credit history and the audit log. If Kie.ai rejects the platform key, credit-paid generation pauses (users with their own key keep generating) until you replace it.

## Branding

- Defaults: **AI Infographic Studio**, tagline "Turn any topic into a clear, professional infographic", accent `#7665e8`, and the supplied logo in `client/public/branding/` (`logo-wordmark.png` for headers, `logo.png` for the square mark, `favicon-32.png` and `favicon.png` for browser and home-screen icons, `og-image.jpg` for link previews), all built from `client/public/Media/Logo.png`. With no changes saved, exactly these are used.
- Changes are stored in `AppSettings` (`branding`) and served to everyone by the public `GET /api/branding`. They apply to the sign-in pages, the app shell, the browser tab title and favicon, the accent colour, password-reset emails, and the MCP server title shown in AI apps.
- Logo: PNG, JPEG or WebP up to 2 MB, at least 32 px. Favicon: square PNG, JPEG or WebP up to 512 KB, 16 to 1024 px. SVG is refused because it can carry scripts. Metadata is removed before storage. Images are stored under `branding/` (inside `STORAGE_KEY_PREFIX` on a shared bucket).
- **Use default** removes an uploaded image. **Reset to defaults** restores everything above.

## Act as user

**Act as user** on a user's page shows the app exactly as that user sees it: their generations, API Settings, MCP Connection and Settings. A banner at the top says whose account is shown and has **Exit**.

- It is read-only. Generating, regenerating, deleting or saving is refused by the server, so nothing changes in the account and the user's Kie.ai credits are never used. Admin pages are closed until you exit.
- It works only for active, regular accounts, never for yourself or another administrator.
- It uses your own sign-in, and signing out ends it. It ends by itself after 60 minutes, or as soon as the account is suspended, deleted or made an administrator.
- Start and end are written to the audit log.
- While acting, you see what the user sees, which is more than the admin pages show: full topics and generated images. The user's API key and its last digits stay hidden. If you have a privacy policy, it should say that administrators can view account content for support.

## What administrators cannot see

- Provider API keys or their last four characters. The admin user-details response contains only provider, status and dates.
- Full prompts in the admin pages. Admin job listings carry a 120-character prompt preview, and the Generations list shows titles, not prompts. (**Act as user** shows the user's own pages; see above.)
- Password hashes, session tokens, reset tokens and OAuth tokens. No route returns them, except OAuth tokens, which go only to the app that requested them, at the token endpoint.
- Tool-call inputs of AI apps. The audit log keeps ids and choices, and only the length of the topic.

This is checked by `tests/integration/secrets.test.js` (debug logs and responses during real flows) and `npm run check:secrets -w server` (source, docs and the built client bundle).
