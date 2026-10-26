# AI Infographic Studio

AI Infographic Studio is a small MERN SaaS that turns a topic into a professional infographic image. A user describes the topic, picks an infographic type (smart layout, tips list, step-by-step, timeline, comparison, pros and cons, statistics, cycle or mind map), a visual style (minimal, corporate, colorful, dark neon, pastel, hand-drawn, isometric 3D, retro or gradient) and an aspect ratio (1:1, 3:4 or 9:16). The server then generates the image with **Z-Image on Kie.ai**, using **that user's own Kie.ai API key**. The finished PNG is stored privately in the user's history, where it can be viewed, downloaded, regenerated or deleted.

The same feature is available to AI assistants (Claude, ChatGPT, Claude Code and other MCP clients) through an OAuth-protected MCP server. Administrators get an admin panel with users, generations, jobs, failures, MCP monitoring, provider models, access switches, audit logs, operations and branding.

Stack: MongoDB + Mongoose, Express 5, React 19 + Vite, Node.js 20.19+. The UI is a light "Soft Modern White" design (Plus Jakarta Sans, lavender accent), with Bootstrap 5 used only as a utility base.

> This project was derived from an earlier codebase. Its job engine, authentication, OAuth/MCP plumbing and admin foundation were reused, and everything else was replaced by the infographic feature.

## Key rules

- **Credits first, then bring your own key.** Every infographic is paid in one of two ways. **Platform credits first:** while the user has enough credits (an admin setting, 10 per infographic by default), the infographic runs on the **platform's** Kie.ai key, which an administrator saves encrypted in Admin > Provider. **Then the user's own key (BYOK):** when credits run out, it runs on the key the user saved in **API Settings**, encrypted at rest (AES-256-GCM). With neither, nothing is created and the API answers `NO_CREDITS`, `NO_API_KEY` or `API_KEY_INVALID`. New accounts start with 0 credits; credits come from bonus sign-up links and admin top-ups, and a failed generation refunds them.
- **Accuracy.** The prompt builder tells the model not to invent statistics, numbers, dates, quotes or sources. Figures should come from the user's topic.
- **Private files.** Generated images are copied into private storage (local disk in development, an S3-compatible bucket in production). They are served only to their owner.

## Quick start

Prerequisites: Node.js 20.19+ and npm 10+. MongoDB is optional locally, because the repository can run a development MongoDB for you.

```bash
npm install
cp server/.env.example server/.env
# edit server/.env: SESSION_SECRET and ENCRYPTION_KEY (see docs/setup.md)
```

**Database.** The app uses its own database, named `ai_infographic_studio` by default (`MONGODB_DB_NAME`). Do not point it at another application's database. If MongoDB is not installed, start the bundled development server in a second terminal:

```bash
DEV_MONGO_PORT=27027 npm run db:dev
```

Then set `MONGODB_URI=mongodb://127.0.0.1:27027` in `server/.env`. Without `DEV_MONGO_PORT`, the script uses port 27017. Data is kept in `server/.mongo-data`.

```bash
npm run check:env
npm run db:indexes
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:5000/api/health and http://localhost:5000/api/ready
- MCP: http://localhost:5000/mcp (OAuth; see `docs/mcp-setup.md`)

**First administrator.** Run this once (see `docs/admin-setup.md`):

```bash
npm run admin:bootstrap -w server -- --email you@example.com --confirm-email you@example.com
```

Public sign-up never creates an administrator.

**First infographic.** Sign in, open **API Settings**, paste your Kie.ai key (https://kie.ai/api-key) and save it. Then use **Create Infographic**. Each generation is a paid task on your own Kie.ai account.

**No Kie.ai key yet?** A development-only mock Kie.ai serves placeholder PNGs, so you can click through the whole flow for free:

```bash
DEV_MOCK_KIE_PORT=5055 DEV_MOCK_KIE_KEY=<any test key of 16+ characters> node server/scripts/devMockKie.js
# in another terminal, start the API against it:
KIE_API_BASE_URL=http://127.0.0.1:5055 KIE_UPLOAD_BASE_URL=http://127.0.0.1:5055 npm run dev:server
```

Then save the same test key in API Settings.

## MCP

The MCP URL is `SERVER_URL/mcp`, and the **MCP Connection** page in the app shows it. The server exposes four tools: `generate_infographic`, `get_generation_status`, `list_infographics` and `get_infographic`. `generate_infographic` is paid and requires `confirm_paid_generation: true`. Access uses OAuth 2.1 with PKCE, Client ID Metadata Documents or Dynamic Client Registration, and a consent page at `CLIENT_URL/connect/approve`.

Claude (web, desktop, mobile) and ChatGPT connect from their own servers, so they need a **public HTTPS** `SERVER_URL`. A localhost server only works for clients on the same computer, such as Claude Code. Details are in `docs/mcp-setup.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API (with `--watch`) and Vite client together. |
| `npm run db:dev` | Development-only local MongoDB (`DEV_MONGO_PORT`, default 27017). |
| `npm run check:env` | Validate `server/.env`. |
| `npm run db:indexes` | Create the MongoDB indexes. |
| `npm run admin:bootstrap -w server -- ...` | One-time owner administrator. |
| `npm run build` / `npm start` | Client production build / run the API. |
| `npm test` | Server tests. They use an in-memory MongoDB and a mock Kie.ai, never a real database or provider. |
| `npm run check:secrets -w server` | Scan sources, docs and the built bundle for secrets. |
| `npm run test:live-kie -w server` | Opt-in live check: one real infographic on Kie.ai. It **spends credits** and needs `server/.env.live-test`. |
| `npm run test:live-storage -w server` | Opt-in check of a real S3/R2 bucket. |

## Testing

```bash
npm test
```

All server suites pass: 203 of 203 as of 2026-10-17. They use `node:test`, `mongodb-memory-server` and a mock Kie.ai. See `docs/test-results.md` for what the suites cover.

## Not yet verified

- A real infographic generated with a real Kie.ai key. Only the mock Kie.ai has been used. `npm run test:live-kie -w server` is the prepared check.
- A live connection from Claude, ChatGPT or Claude Code. These need a public HTTPS deployment, except Claude Code, which can be tried locally.
- A production deployment.

## Repository layout

```
client/   React + Vite app (src/pages, components, routes, services, context, hooks, utils, styles)
server/   Express API (src/config, routes, middleware, validators, controllers, services, models, providers, jobs, mcp, utils)
          scripts/ (env check, indexes, admin bootstrap, dev MongoDB, dev mock Kie.ai, live checks, secret scan)
          tests/ (integration and security suites, fixtures)
docs/     setup, architecture, api, mcp-setup, deployment, admin-setup, test-results
```

## Documentation

| Document | Contents |
|---|---|
| `docs/setup.md` | Local setup, environment, first steps, troubleshooting |
| `docs/architecture.md` | Layers, rules, data model, the infographic and job pipeline, MCP and OAuth, frontend |
| `docs/api.md` | Every endpoint and the error format |
| `docs/mcp-setup.md` | MCP server, OAuth, scopes, tools, connecting Claude, Claude Code and ChatGPT |
| `docs/deployment.md` | Topologies, production environment, database, storage, MCP/OAuth, go-live checklist |
| `docs/admin-setup.md` | Owner bootstrap, the admin panel, branding, what admins cannot see |
| `docs/test-results.md` | How to run the tests and what they cover |

## Branding

The default logo is `client/public/Media/Logo.png`; the files in `client/public/branding/` (wordmark, square mark, favicons, link-preview image) are built from it. Administrators can change the name, tagline, accent colour, logo and favicon under **Admin Panel > Branding**. With no changes saved, the defaults are used.
