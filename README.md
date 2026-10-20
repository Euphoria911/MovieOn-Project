# MovieOn

A streaming web app for **movies, series and anime** in a red/black, Netflix-style design: a free catalog plus **Silver / Gold / Diamond** subscription plans, search and filters, a clean player (MP4 + HLS, or VK's official embed), watchlist, ratings, and automatic **resume / continue watching**. Includes an admin back-office, a REST API, automated tests, Docker and CI — plus the full SDLC documentation (`docs/`, also as one PDF).

> **Content & legal.** MovieOn streams whatever video URLs an admin adds, so you must only publish content you are licensed to distribute. The bundled demo catalog uses the Blender Foundation's open movies (CC-BY) and clearly labelled *fictional placeholder* titles that reuse those sample videos. Replace them before any public launch. See `docs/01-planning-and-requirements.md` §2.

> **Payments are a demo.** The checkout records a fake payment and charges nobody; it is enabled by default only in development. Plan prices are USD placeholders. Before charging real money you must integrate a real payment provider (`docs/04-deployment-and-operations.md` §12).

> **VK videos.** MovieOn does **not** extract direct stream links from VK. An admin can attach VK's *official embed* link for a video they own or are licensed to show, together with a mandatory rights note.

## Features

- Home with rotating hero, rows (Trending, New, Movies, Series, Anime) and **Continue watching**
- Catalog: filter by type and genre, sort (newest / most watched / top rated / A–Z), pagination, text search
- Title pages: synopsis, genres, age rating, seasons and episodes, 1–5★ ratings, **My List**
- Player: MP4 and HLS (`.m3u8`, via hls.js or native Safari), saved position every 10 s, resume, **next-episode autoplay**, shortcuts (Space, ←/→, F, M, N), error + retry
- Accounts: register / login / logout (httpOnly SameSite=Strict cookie, bcrypt)
- Admin: create/edit/delete titles, publish/unpublish (draft), feature on home, manage episodes
- **Plans & tiers:** every title is Free, Silver, Gold or Diamond; Silver / Gold / Diamond cost $4.99 / $8.99 / $12.99 per 30 days (placeholders) and allow 1 / 2 / 4 simultaneous screens. Enforced on the server — video URLs are only issued by `POST /api/playback` after the tier and screen checks
- **Free catalog:** "Free to watch" row on home and a Free filter in Browse; free titles play without an account
- Account page: plan status, cancel / resume, payment history; Plans and demo-checkout pages
- Admin: tier per title, rights note, VK embed links, grant / revoke a plan for a user by email
- Red/black dark design (single theme), responsive (≥ 360 px), keyboard accessible, no external fonts/CDNs/trackers
- **Custom icons and animation (v1.1.1):** original SVG icon set instead of emoji; intro splash, animated hero, hover/entrance effects, drawn check marks, plan-activation celebration, player loader and next-episode countdown ring — all switched off by `prefers-reduced-motion`

## Quick start

Requires Node.js 22+.

```bash
cd server
npm ci
npm start            # http://localhost:3000
```

On first start the demo catalog is seeded and (outside production) a **dev admin** is created: `admin@movieon.local` / `admin12345`. Never use it in production.

Docker:

```bash
cp .env.example .env     # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up --build -d
```

> The Docker image has not been built in the environment where this project was generated (no Docker daemon). CI builds it and health-checks the container; run `docker compose up --build` once locally to confirm.

## Tests

```bash
cd server && npm test                    # 66 API/integration tests
cd e2e && npm ci && npx playwright install chromium && npm test   # 20-step browser run (needs ffmpeg)
```

## Project layout

```
movieon/
├─ docs/                      00 functions overview · SDLC: 01 requirements · 02 design · 03 testing · 04 deployment & operations
├─ MovieOn-SDLC-and-Functions.pdf   all functions + SDLC in one document
├─ server/
│  ├─ src/
│  │  ├─ index.js             entry point, env config, graceful shutdown
│  │  ├─ app.js               Express app: security headers, rate limits, CSRF check, routes, static client
│  │  ├─ db.js                SQLite schema + numbered migrations (V1 base, V2 tiers/subscriptions)
│  │  ├─ plans.js · entitlements.js   plans/tiers/screens and access checks
│  │  ├─ sources.js           video source validation (files, VK official embed, rights note)
│  │  ├─ auth.js              cookie session, requireAuth / requireAdmin
│  │  ├─ catalog.js           list/search/serialise queries
│  │  ├─ progress.js          continue-watching logic
│  │  ├─ seed.js · seed-cli.js · admin-cli.js
│  │  └─ routes/              auth · titles · me · playback · billing · admin
│  └─ test/                   node:test suites (66 tests): api.test.js, subscriptions.test.js
├─ web/                       static client (vanilla ES modules, no build step)
│  ├─ index.html · css/styles.css   (tokens, layout, motion layer)
│  └─ js/                     main · router · api · state · dom · icons · ui · pages/* (incl. plans, account)
├─ e2e/                       Playwright smoke test
├─ Dockerfile · docker-compose.yml · .env.example
└─ .github/workflows/ci.yml
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `DB_PATH` | `./data/movieon.db` | SQLite file |
| `JWT_SECRET` | random in dev; **required** in production | Session signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | dev admin outside production | Admin created at first start |
| `COOKIE_SECURE` | `true` in production | Set `true` when served over HTTPS (also enables HSTS) |
| `SEED_DEMO` | `true` | `false` for an empty catalog |
| `MEDIA_ORIGINS` | any `https:` | CSP allow-list for video hosts |
| `TRUST_PROXY` | off | Number of reverse proxies in front |
| `BILLING_PROVIDER` | `mock` in dev, `none` in production | `mock` = demo checkout (no real money); `none` = checkout disabled, admins grant plans |

Full table and operations guidance: `docs/04-deployment-and-operations.md`.

## API at a glance

`/api/health` · `/api/auth/{register,login,logout,me}` · `/api/home` · `/api/genres` · `/api/titles?type&genre&q&tier&sort&page&limit` · `/api/titles/:slug` · `/api/titles/:id/rating` · `/api/playback` (+ `/:id/heartbeat`) · `/api/plans` · `/api/billing/{subscription,checkout,cancel,resume}` · `/api/watchlist` · `/api/progress` · `/api/admin/*`

Details, validation rules and the data model: `docs/02-design.md`.

## Adding your own content

1. Sign in as admin → **Admin** (`/#/admin`).
2. *Add title* (movie: paste an MP4 or HLS URL; series/anime: create the title, then **Episodes** → add season/number/URL). Pick **Available on** (Free / Silver / Gold / Diamond).
3. Videos must be served by a host that supports **HTTP Range** requests (any CDN/object storage does), otherwise seeking and resume will not work. Restrict `MEDIA_ORIGINS` to your video hosts in production.
4. Set `SEED_DEMO=false` before the first start to skip the demo titles.

**VK videos (official embed only).** In VK open the video you have rights to, use *Share → Export / embed code*, and paste the iframe `src` (`https://vkvideo.ru/video_ext.php?oid=…&id=…&hash=…`). Fill the **Rights note**. Ordinary `vk.com/video…` page links are rejected. Embedded videos play in VK's own player, so progress/resume and next-episode autoplay do not apply to them.

**Giving someone a plan without payment:** Admin → *Grant a plan* (email, plan, days).

## Known limitations (v1.1.1)

No real payment provider (demo checkout only; no auto-renewal, proration, invoices or tax); a video URL that has been issued to a paying viewer can be copied (signed URLs/DRM are roadmap); plans do not differ by picture quality; the VK embed is tested against a stub, not a live VK video; no password reset/change UI, subtitles, upload/transcoding, geo-restrictions or multi-profile; English-only UI; HLS playback is verified manually. The Docker image has not been built in the generation environment. Roadmap: `docs/01-planning-and-requirements.md` §10 and `docs/04-deployment-and-operations.md` §11.

## License

Application code: MIT. Demo videos belong to their authors (Blender Foundation, CC-BY 3.0) and are streamed from third-party hosts that may go offline.
