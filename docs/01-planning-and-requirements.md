# MovieOn — Phase 1: Planning & Requirements

Version 1.1.1 · 2026-10-20

> **Changes in 1.1.1:** original SVG icon set replacing emoji/glyph icons (FR-26) and a full motion layer — splash, page/entrance/hover animations, celebration, player loader, countdown ring — that honours `prefers-reduced-motion` (FR-27). No back-end or data changes.
>
> **Changes in 1.1:** content tiers and subscription plans (Silver / Gold / Diamond), server-side entitlement checks and simultaneous-screen limits, a free catalog, official VK embed support (rights-note gated), red/black visual redesign (light theme removed), numbered database migrations. Payments are a **demo provider only** — see §2 and §9.

## 1. Vision

MovieOn is a web streaming platform where people watch **movies, series and anime** in one catalog, with a clean player, a personal watchlist and automatic "continue watching".

**Product statement:** *For viewers who juggle several apps to follow films, shows and anime, MovieOn is a single, fast, ad-light catalog with resume-anywhere playback — a free tier to start and Silver / Gold / Diamond plans for more titles and more screens. Unlike piracy aggregators, MovieOn only streams content the operator is licensed to distribute.*

**Business model (v1.1):** freemium. A free catalog (watchable without an account) drives acquisition; three paid plans unlock higher content tiers and more simultaneous screens. Plan prices in this repository are **placeholders in USD** to be set by the operator.

## 2. Content and legal model (critical constraint)

A streaming site is only viable if the operator holds distribution rights. This shapes the product:

| Topic | Decision |
|---|---|
| Content source | Operator-owned, licensed (distributor/aggregator agreements) or openly licensed (e.g. Blender Foundation open movies, CC-BY, public domain). |
| Pirated content | Out of scope. The platform does not crawl, embed or proxy third-party pirate streams. |
| Third-party hosted video (VK) | **Decision (v1.1):** the platform does **not** scrape or extract direct stream links from VK or any other site (that circumvents the host's player and terms, and most "free movies" uploaded by users are unlicensed). Instead an admin may attach VK's **official embed** (`video_ext.php`) for a video the operator owns or is licensed/permitted to show; a **rights note** (who owns it / what permits embedding) is mandatory and stored with the title. VK page links are rejected. Rights are the operator's responsibility; the embed can disappear if the uploader removes the video or disables embedding. |
| Payments | v1.1 ships a **demo billing provider** that records a successful payment without collecting any card data. A real provider (hosted checkout + signed webhooks) is required before charging anyone — see roadmap. The platform never stores card numbers. |
| Prices | Placeholder USD prices (Silver 4.99, Gold 8.99, Diamond 12.99 per 30 days) defined in `server/src/plans.js`. Tax/VAT, invoicing, refunds and local-currency pricing are not implemented. |
| Demo data | The seed catalog uses openly licensed Blender films plus clearly fictional placeholder titles that reuse those sample videos. Real rights must be added before launch. |
| Takedown | Admin can unpublish/delete any title immediately; a DMCA/notice-and-takedown process is defined in the operations doc. |
| Geo-rights | Not implemented; listed in the roadmap (needed for real licensing deals). |
| Age ratings | Every title carries an age rating label (`0+`, `6+`, `12+`, `16+`, `18+`). Parental controls are in the roadmap. |
| Privacy | Minimal personal data: email, username, password hash, watch history, subscription and payment records (plan, amount, date). GDPR-style export/delete is a roadmap item. Opening a VK embed loads VK's player and therefore VK's own cookies/tracking for that page — disclose in the privacy policy. |

## 3. SDLC model

**Iterative Agile (Scrum-lite), 2-week sprints**, with a thin waterfall-style documentation gate at the start (this folder). Rationale: requirements around content and licensing change, UX needs fast feedback, but the data model and security posture must be settled early.

| Phase | Output | Where |
|---|---|---|
| 0. Functions overview | Every function by actor, plans, boundaries | `00-functions-overview.md` |
| 1. Planning & requirements | Vision, scope, requirements, risks | this document |
| 2. Design | Architecture, data model, API, security, UI | `02-design.md` |
| 3. Implementation | Server, web client, seed data | `server/`, `web/` |
| 4. Testing | Strategy, traceability, automated suite | `03-testing.md`, `server/test/` |
| 5. Deployment | Docker, CI/CD, config, runbook | `04-deployment-and-operations.md` |
| 6. Maintenance | Monitoring, backups, release cadence, roadmap | `04-deployment-and-operations.md` |

Definition of Done per story: code merged via PR, automated tests pass in CI, linted, documented in API table if an endpoint changed, accessibility check on touched screens, no new high-severity `npm audit` findings.

## 4. Stakeholders and personas

| Persona | Goal | Pain today |
|---|---|---|
| **Aigul, 24, student** — watches anime and series on her phone | Find something quickly, pick up where she stopped | Many apps, no shared history |
| **Rustam, 38, parent** | Browse by genre and age rating | Unclear ratings, cluttered UI |
| **Dilnoza, content manager (admin)** | Add titles/episodes, remove titles on request | Needs a simple back-office, not SQL |
| **Operator/owner** | Low run cost, legal safety, growth metrics | Hosting and licensing cost |

## 5. Scope

**In scope (v1.0 MVP):** accounts, catalog (movies/series/anime), genres, search, details with seasons/episodes, MP4 and HLS playback, resume, next-episode, watchlist, 1–5 star ratings, trending by views, admin back-office, responsive UI, REST API, tests, Docker, CI.

**Added in v1.1:** content tiers (Free / Silver / Gold / Diamond), subscription plans with account page (cancel / resume / payment history), demo checkout, server-side playback authorisation, simultaneous-screen limits, free catalog row and filter, official VK embed with rights note, admin tier / rights / grant-revoke tools, red/black Netflix-style visual design, numbered DB migrations.

**Out of scope (v1.1):** a real payment provider, automatic renewal, proration, invoices/tax, DRM, live TV, downloads/offline, comments, recommendations ML, multi-profile, native apps, subtitles upload pipeline, transcoding service, geo-restriction, **picture-quality (resolution) tiers** — plans differ by catalog access and screens only, because each title is a single source.

## 6. Functional requirements (MoSCoW)

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Visitor can register with email, username, password (min 8 chars). | Must |
| FR-02 | User can log in, log out, and stay signed in via secure cookie session (7 days). | Must |
| FR-03 | Home page shows a featured hero and rows: Trending, New releases, Movies, Series, Anime, and Continue Watching (signed-in). | Must |
| FR-04 | Catalog can be filtered by type, genre and sorted (newest, name, rating, popular). | Must |
| FR-05 | Search by title/synopsis text with results page. | Must |
| FR-06 | Title page shows poster, synopsis, year, age rating, genres, average rating, episodes grouped by season. | Must |
| FR-07 | Player plays MP4 and HLS (`.m3u8`) sources in the browser, with native controls and fullscreen. | Must |
| FR-08 | Playback position is saved periodically and restored on return; Continue Watching lists unfinished items. | Must |
| FR-09 | User can add/remove titles to a personal watchlist. | Must |
| FR-10 | User can rate a title 1–5 stars; average and count are displayed. | Should |
| FR-11 | When an episode ends, the player offers/auto-plays the next episode. | Should |
| FR-12 | Admin can create, edit, delete titles and add/delete episodes; set featured/draft. | Must |
| FR-13 | "Trending" is computed from view counts (a view = an authorised playback start, counted server-side). | Should |
| FR-14 | UI is responsive from 360 px to 4K and keyboard accessible. | Must |
| FR-15 | Keyboard shortcuts in player: Space, F, M, ←/→ (10 s), N (next episode). | Could |
| FR-16 | *(changed in 1.1)* Single dark red/black visual design in the style of mainstream streaming apps (own wordmark, no third-party logos). The light theme and toggle of v1.0 were removed. | Should |
| FR-17 | Every title has a minimum tier: `free`, `silver`, `gold` or `diamond`. Free titles can be watched without an account. | Must |
| FR-18 | Three paid plans — **Silver** (1 screen), **Gold** (2 screens), **Diamond** (4 screens). A plan unlocks its own tier and all lower tiers. Free viewers get 1 screen. | Must |
| FR-19 | Entitlements are enforced **server-side**: video URLs are absent from all public payloads and are returned only by `POST /api/playback` after the tier and screen checks. | Must |
| FR-20 | Signed-in user can subscribe (checkout), change plan, cancel (access continues to period end), resume a canceled plan, and see status and payment history on an account page. In v1.1 checkout is backed by a demo provider. | Must |
| FR-21 | Simultaneous screens are limited per plan using playback sessions with a 30 s heartbeat and 90 s expiry; a tab starting a new playback replaces its own session. | Must |
| FR-22 | Visitors can browse the free catalog: "Free to watch" row on home, `Free` filter (and Silver/Gold/Diamond filters) in Browse. | Should |
| FR-23 | Admin can attach a VK official embed link to a movie/episode; the link is validated and normalised, VK page links are rejected, and a rights note is required. | Should |
| FR-24 | Admin can set a title's tier and rights note and can grant or revoke a subscription for a user by email. | Must |
| FR-25 | Locked titles are labelled (tier badge, lock) and offer an "Unlock with [plan]" action; the player explains login / upgrade / screen-limit situations. | Should |
| FR-26 | *(1.1.1)* The UI uses one original SVG icon set instead of emoji or text glyphs; icons inherit the text colour, are decorative (`aria-hidden`) and never the only carrier of meaning. | Should |
| FR-27 | *(1.1.1)* Custom motion: intro splash (once per session), page / list entrance, hover and press feedback, drawn check marks, plan-activation celebration, player loading spinner and next-episode countdown ring. With `prefers-reduced-motion: reduce` nothing animates and the splash is skipped. Only `transform`, `opacity`, `stroke-dashoffset` and `box-shadow` are animated; no animation library and no inline `style` attributes (CSP). | Should |

## 7. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | Catalog/list API p95 < 200 ms at 100 req/s on 1 vCPU / 512 MB; first contentful paint < 2 s on 4G for the home page. |
| NFR-02 | Security | Passwords hashed with bcrypt (cost ≥ 10); httpOnly, SameSite=Strict session cookie; rate-limited auth; strict CSP (framing limited to the VK embed hosts); all SQL parameterised; no user data injected through `innerHTML`; entitlement decisions made only on the server; no card data handled. |
| NFR-03 | Availability | 99.5 % monthly for the web/API tier (excluding third-party video hosts). |
| NFR-04 | Accessibility | Target WCAG 2.1 AA: focus visible, labels, contrast ≥ 4.5:1, reduced-motion respected. |
| NFR-05 | Compatibility | Latest 2 versions of Chrome, Edge, Firefox, Safari; iOS Safari plays HLS natively. |
| NFR-06 | Maintainability | ≥ 80 % of API routes covered by automated tests; ES modules; no build step for the client. |
| NFR-07 | Portability | Runs from a single container; SQLite for MVP with a documented path to PostgreSQL. |
| NFR-08 | Observability | Structured request logs, `/api/health` endpoint. |
| NFR-09 | Privacy | No third-party trackers; no external fonts or CDNs on the critical path (a VK embed is the one third-party player, loaded only on titles that use it). |
| NFR-10 | Localisation | Target: translations (ru, uz). v1.1 still ships English only with UI strings inline in the page modules; extracting them into a dictionary is the first step of that work. |
| NFR-11 | Data evolution | Schema changes are applied by ordered, transactional migrations tracked with `PRAGMA user_version`; an existing v1.0 database upgrades in place without data loss. |

## 8. User stories and acceptance criteria (excerpt)

**US-1 (FR-08)** As a viewer I want playback to resume so I don't search for my place.
- Given I watched 12:40 of an episode and left, when I reopen it, then the player starts at ≈12:40.
- Given I finished (≥ 95 %), then it disappears from Continue Watching and progress resets for the next episode.

**US-2 (FR-04/05)** As a viewer I want to filter anime by genre.
- Given type = anime and genre = Action, then only anime tagged Action are listed, paginated.
- Given a query with no match, then an explicit empty state is shown.

**US-3 (FR-12)** As an admin I want to add a series with episodes.
- Given I am admin, when I submit the title form, then it appears in the catalog (if published) and I can add episodes with season/number.
- Given I am a normal user, then admin endpoints return 403 and the Admin link is hidden.

**US-4 (FR-02/NFR-02)** As a user I want a secure login.
- Given 21 failed requests from one IP in 15 minutes, then further attempts get 429.
- Given an invalid password, then the message does not reveal whether the email exists.

**US-5 (FR-17/18/19/20)** As a viewer I want to unlock more titles with a plan.
- Given I am on the Free plan and open a Gold title, then I see a Gold badge and "Unlock with Gold", and the player refuses to start (403 `upgrade_required`) without ever receiving the video URL.
- Given I confirm checkout for Gold, then I can play Gold and Silver titles immediately and my account page shows the plan, end date and the payment.
- Given I cancel, then I keep access until the paid period ends; after that Gold titles are locked again.

**US-6 (FR-21)** As an operator I want plans to limit simultaneous screens.
- Given a Silver subscriber is watching on one device, when a second device starts playback, then it is refused with `screen_limit` (1 screen); a Gold subscriber can use two screens, Diamond four.
- Given a device stops sending heartbeats for 90 s (closed laptop), then its slot is freed.

**US-7 (FR-23)** As an admin I want to show a video I have rights to from VK.
- Given I paste an ordinary `vk.com/video…` page link, then it is rejected with instructions to use the official embed link.
- Given I paste the embed link but leave the rights note empty, then saving fails; with a rights note it is stored normalised and plays in VK's own player (progress/Continue watching are not tracked for embeds).

## 9. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | No distribution rights / takedown claims | High | Critical | Licensed or open content only; takedown process; admin delete |
| R2 | Video bandwidth cost | Med | High | HLS via CDN, adaptive bitrate, cache headers; third-party hosting in MVP |
| R3 | Third-party sample URLs go offline | Med | Low | Demo only; documented; player shows an error state |
| R4 | Account abuse / credential stuffing | Med | Med | Rate limits, bcrypt, generic errors; 2FA in roadmap |
| R5 | SQLite write contention at scale | Low (MVP) | Med | WAL mode; migration plan to PostgreSQL |
| R6 | Scope creep (payments, DRM) | High | Med | Explicit out-of-scope list; roadmap gating |
| R7 | Minors viewing mature content | Med | High | Age labels now; parental PIN/profiles in v1.3 |
| R8 | Charging real money with the demo provider or mishandling card data | Low | Critical | Demo provider collects no card data and is disabled by default in production (`BILLING_PROVIDER=none`); real provider must use a hosted checkout + signed webhooks so card data never touches this server |
| R9 | A paying user copies the video URL once issued and shares it | Med | Med | URL is only issued after checks, but cannot be un-issued. Real protection = short-lived signed CDN URLs (v1.4) and DRM (v2.0); accepted for v1.1 and documented |
| R10 | Embedded VK video removed, restricted or claimed | Med | Med | Mandatory rights note; player shows VK's own error; periodic manual review; prefer self-hosted licensed files |
| R11 | Placeholder prices/plan limits mistaken for a final offer | Med | Low | Marked as placeholders in docs and checkout; single source of truth `plans.js` |
| R12 | Subscription state drifts from a real provider (manual grants, expiry) | Med | Med | Provider webhook is the only writer in production (roadmap); admin grants are labelled `provider='admin'` |

## 10. Release roadmap

| Release | Content |
|---|---|
| v1.0 MVP | Catalog, player, resume, watchlist, ratings, admin, Docker, CI |
| v1.1 | Tiers and plans (Silver/Gold/Diamond), entitlement enforcement, screen limits, demo checkout + account, free catalog, VK official embed, red/black redesign, numbered migrations |
| **v1.1.1** (this repo) | Custom SVG icon set, full motion layer, reduced-motion support |
| v1.2 | **Real payments:** hosted checkout + signed webhooks (candidates to evaluate: an international provider such as Stripe; regional providers such as Payme/Click for Uzbekistan — none is integrated or verified here), auto-renewal, proration, invoices/tax, dunning; subtitles (WebVTT), GDPR export/delete, email verification, password reset, ru/uz translations |
| v1.3 | Multi-profile + parental PIN, PostgreSQL, Redis cache, Elasticsearch/pg_trgm search |
| v1.4 | Upload + transcoding pipeline (FFmpeg → HLS ladder → object storage/CDN) with signed expiring URLs, geo-rights, optional resolution tiers |
| v2.0 | DRM (Widevine/FairPlay), recommendations, native apps |

## 11. Assumptions

- Node.js 22 LTS runtime; operator provides HTTPS termination (reverse proxy or platform).
- Poster/backdrop art in the MVP is generated from per-title colour pairs; real artwork URLs can replace it via the admin form later.
