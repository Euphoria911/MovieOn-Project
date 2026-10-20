# MovieOn — Phase 4: Testing

Version 1.1.1 · 2026-10-20

## 1. Strategy

| Level | Tool | Scope | Where | Run |
|---|---|---|---|---|
| Unit/API integration | Node built-in test runner (`node:test`) + real HTTP against the Express app on an in-memory SQLite DB | Every REST endpoint, validation, authorisation, tier/screen enforcement, billing lifecycle, embed validation, migrations, security headers, rate limiting | `server/test/` (`api.test.js`, `subscriptions.test.js`) | `cd server && npm test` |
| End-to-end (browser) | Playwright + Chromium against the real server and UI | Core user journeys, player behaviour, locked-title flow, plans → demo checkout → unlock, VK embed (stubbed host), dark red/black design, mobile layout, CSP cleanliness | `e2e/smoke.mjs` | `cd e2e && npm install && npx playwright install chromium && npm test` |
| Performance | autocannon (ad-hoc) | Catalog read endpoints and playback authorisation | see section 5 | manual |
| Dependency security | `npm audit` | Production dependencies | CI job `test` | automatic |
| Manual / exploratory | Checklist in section 6 | Real devices, real video hosts | – | before each release |

Design choices: tests exercise the public HTTP contract rather than internals, so refactoring does not break them. The e2e job substitutes the third-party demo video URLs with a locally generated WebM that is served **with HTTP Range support** (needed by browsers for seeking, i.e. resume), so player logic is tested without internet access or dependence on external hosts. The VK embed host is **stubbed** (the iframe loads a placeholder page): the tests verify validation, storage, the sandboxed iframe and CSP — not VK's real player.

## 2. Requirements traceability

| Requirement | Automated verification |
|---|---|
| FR-01 Register | API: *register validation*, *register → cookie flags → me → logout*, *duplicate email → 409* · E2E: *register signs the user in* |
| FR-02 Login/logout/session | API: *login: wrong password and unknown email give the same message*, *tampered cookie is treated as anonymous* · E2E: *sign out; admin signs in…* |
| FR-03 Home rows | API: *home: hero, rows, empty continue-watching for anonymous* · E2E: *home renders hero and rows*, *player… Continue watching* |
| FR-04 Filter/sort | API: *filter by type*, *filter by genre…*, *sort by name…*, *pagination covers disjoint pages*, *invalid query params → 400* · E2E: *browse anime + genre filter* |
| FR-05 Search | API: *search by name and synopsis…*, *LIKE wildcards…*, *SQL injection attempts…* · E2E: *search finds Orbit Station* |
| FR-06 Title details | API: *detail payload never exposes video URLs; series episodes are ordered*, *unknown slug → 404* · E2E: *title page: details, watchlist, rating* |
| FR-07 Playback | E2E: *player: plays, saves progress, resumes* (MP4/WebM path). HLS path is covered **manually** (section 6) — see limitation L1 |
| FR-08 Resume / continue watching | API: *movie progress appears…*, *finished movie and tiny positions are not listed*, *series: episodeId is required…*, *position is clamped…* · E2E: *player: plays, saves progress, resumes* |
| FR-09 Watchlist | API: three tests in suite *FR-09 watchlist* · E2E: *title page…*, *watchlist page lists the title* |
| FR-10 Ratings | API: *validation, update and aggregation* · E2E: *title page…* |
| FR-11 Next episode | API: *finishing an episode surfaces the next one; finishing the last drops the series* · E2E: *player: next-episode overlay and Play now* |
| FR-12 Admin | API: six tests in suite *FR-12 admin* (authorisation, draft lifecycle, validation, unique slugs, draft isolation, live role changes) · E2E: *sign out; admin signs in and manages catalog* |
| FR-13 Trending | API: *FR-13: playback start counts a view and feeds "popular" sort* |
| FR-14 Responsive/keyboard | E2E: *mobile viewport has no horizontal overflow* (390 px) · accessibility audit is manual (section 6) |
| FR-15 Shortcuts | E2E: *keyboard shortcut M toggles mute* (other shortcuts manual) |
| FR-16 Red/black design | E2E: *design is dark red/black regardless of OS preference; no theme toggle* (checks body `rgb(20,20,20)`, primary button `rgb(229,9,20)`, no theme control, under both OS colour schemes) |
| FR-17 Tiers | API: *admin: tiers and tier filter*, *list returns paginated items without video URLs* |
| FR-18 Plans | API: *GET /api/plans lists Silver < Gold < Diamond…*, *plan ladder: each plan unlocks its own tier and below, never above* |
| FR-19 Server-side enforcement | API: *anonymous: free title plays…, paid title → 401*, *403 carries a machine-readable code…*, *playback validates input*, *detail payload never exposes video URLs* · E2E: *gated title: server refuses playback and the player explains why* (also asserts the public JSON contains no media URL) |
| FR-20 Checkout / account | API: five tests in suite *checkout and subscription lifecycle* (auth + validation, subscribe → upgrade → history, cancel/resume/expiry, 503 without provider, admin grant/revoke) · E2E: *plans page → demo checkout → Gold unlocks the title*, *cancel keeps access until period end; resume restores* |
| FR-21 Screens | API: five tests in suite *simultaneous screens* (1 / 2 / 4 screens, own-tab replacement, release on stop, stale expiry, heartbeat 200/404/403, session ownership) |
| FR-22 Free catalog | API: *create/update minTier; catalog ?tier= filter…* (home *Free to watch* row asserted there) · E2E: *browse: Free filter shows only free titles*, *home renders hero and rows* |
| FR-23 VK embed | API: five tests in suite *VK embed sources* (page links rejected, rights note required, normalisation + `kind=embed`, malformed/non-VK hosts, episode rule, CSP `frame-src`) · E2E: admin step creating *VK Demo* (page link refused → rights note required → sandboxed iframe rendered) |
| FR-24 Admin tier / grant | API: *admin: tiers and tier filter*, *admin can grant and revoke subscriptions; users cannot* · E2E: admin form |
| FR-25 Locked-state UI | E2E: *title page…* asserts "Unlock with Gold"; *gated title…* asserts the overlay; plans/account screenshots reviewed |
| FR-26 Icon set | E2E: *icons: custom SVG set, no emoji or glyph icons anywhere in the UI text* (≥ 10 `svg.icon`, all `aria-hidden`, visible text contains no pictographic or arrow/star/check glyph) |
| FR-27 Motion | E2E: *animations: splash once per session, entrance + hover motion present* (letters drawn, splash removed and not repeated after reload, `.enter` has an animation, header `scrolled` class, Play button fades in on hover, ripple on press, no console errors) · *prefers-reduced-motion: no splash, no running animations* (no infinite animation, `animation-name: none` on entrance elements) · the checkout step asserts the celebration overlay |
| NFR-11 Migrations | API: *a v1.0 database is upgraded in place and keeps its data* (creates a v1 DB, reopens, checks version, data and defaults, idempotent reopen) |
| NFR-02 Security | API: *security headers…*, *cross-origin state-changing request is blocked*, *auth endpoints return 429 after 20 attempts*, SQL-injection and authorisation tests · E2E: *no CSP violations or script errors in the console* · CI: `npm audit` |
| NFR-08 Observability | API: *GET /api/health* |

## 3. Current results (v1.1.1, 2026-10-20)

| Suite | Result |
|---|---|
| API / integration | **66 passed, 0 failed** (16 suites; 42 from v1.0 adapted, 24 new) |
| End-to-end (Chromium headless, 1280×800 and 390×844) | **20 / 20 steps passed** (3 new in 1.1.1: icons, splash + motion, reduced motion), 0 script errors, 0 CSP violations. Expected 4xx responses (locked title, rejected VK link) show up as browser "Failed to load resource" lines and are filtered by the test |
| `npm audit` (server production deps, e2e) | 0 vulnerabilities |
| Production-mode smoke (container file layout, run directly with Node) | start-up OK; refuses to start without `JWT_SECRET`; static client and vendored hls.js served; session cookie issued over HTTP when `COOKIE_SECURE=false`; CSP without HSTS/`upgrade-insecure-requests` on plain HTTP |
| Docker image build | **Not executed** — no Docker daemon in the build environment. The CI job `docker` builds the image and checks `/api/health`; run `docker compose up --build` once locally before release |

Defects found and fixed during testing (v1.0 items 1–4, v1.1 items 5–8, v1.1.1 items 9–10):

1. Admin edit form would have blanked a movie's source URL (list endpoint did not expose it) → admin list now returns `videoUrl`; form omits an empty URL instead of sending null.
2. `upgrade-insecure-requests` and HSTS were tied to `NODE_ENV=production`, which would break a production container reached over plain HTTP (e.g. local `docker compose up`) → now tied to `COOKIE_SECURE=true`.
3. Hero text was unreadable-prone in light theme (text colour followed the theme while the artwork is always dark) → hero now always uses light text over a dark scrim.
4. Resume looked broken in e2e; root cause was the test stub lacking HTTP Range support, not the app. Stub now behaves like a CDN. (Documented because real hosts **must** support Range for resume to work.)
5. *(v1.1)* My first plan-ladder test failed because it started several playbacks in one tab for a 1-screen plan; the app was right (each new client id is a new screen). Test now uses one client id per viewer, as a real tab does.
6. *(v1.1)* Two e2e races found by repeated runs (each ≈ 1 failure in 4): the plans step counted cards before the data had loaded, and the browse step counted cards of the previous page during navigation. Both now wait for the final DOM state (`.grid:not([aria-busy])`, `.plan-diamond`). Application behaviour was correct.
7. *(v1.1)* Browse page rendered the literal text `null` under the grid when there was only one page (`replaceChildren` stringifies `null`; a v1.0 latent bug visible in the new screenshots) → rendering now goes through the null-skipping DOM helper (also applied to the admin table).
8. *(v1.1)* Header showed the **Free** badge for admins (who have Diamond-level access) → shows **Admin**. Nav links were clipped at 1280 px → no-shrink links and narrower search field.
9. *(v1.1.1)* Found in code review before the first run: the plan-activation overlay reused the class `tier-gold`, which also carries the badge's solid gold background, so the whole screen would have turned gold. Renamed to `cel-gold` / `cel-silver` / `cel-diamond`.
10. *(v1.1.1)* The first run of the new "no emoji" step failed on `©` in the footer (Unicode classifies it as pictographic). That was a test bug, not an application defect; the check now ignores `©`. The title-page screenshot also showed a half-filled star row because the pointer hovered a star after the label width changed; the test now parks the pointer first.

## 4. Test cases — representative detail

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-AUTH-04 | Enumeration resistance | Login with a registered email + wrong password; login with an unknown email | Both: 401, identical message |
| TC-CSRF-01 | Cross-origin write | `POST /api/auth/login` with `Origin: http://evil.example` | 403 |
| TC-CAT-07 | Wildcard literal | `GET /api/titles?q=%` | 0 results (not "everything") |
| TC-PRG-05 | Series completion | Finish episode 1 of a 4-episode series | Continue-watching shows episode 2 at 0:00; finishing episode 4 removes the series from the list |
| TC-ADM-03 | Draft isolation | Admin creates draft; anonymous requests it | List excludes it; detail 404; watchlist/rating/view calls 404 |
| TC-ADM-06 | Role revocation | Promote then demote a user in the DB | Next request reflects the change (role read per request, not baked into the token) |
| TC-RATE-01 | Brute force | 22 failed logins from one client | 429 after the 20th |
| TC-ENT-01 | Direct API bypass | Anonymous `POST /api/playback` for a Gold title | 401 `login_required`, no URL in the body |
| TC-ENT-02 | Upgrade ladder | Free / Silver / Gold / Diamond users request one title of each tier | Free: 200,403,403,403 · Silver: 200,200,403,403 · Gold: 200,200,200,403 · Diamond: all 200 |
| TC-ENT-03 | Expiry | Set `current_period_end` in the past | `/auth/me` level 0; playback 403; heartbeat of a running session 403 and slot removed |
| TC-SCR-01 | Screen limit | Silver user starts playback in tab A, then tab B | Tab B 403 `screen_limit`; after A stops (or 90 s without heartbeat) B succeeds |
| TC-SCR-02 | Tab reuse | Same tab starts playback twice | Second call replaces the first session, no limit hit |
| TC-BIL-01 | Demo checkout | Subscribe Silver → Gold | 201 each; payments list newest first (Gold 899¢, Silver 499¢); same plan again → 409 |
| TC-BIL-02 | No provider | Boot with `billingProvider:'none'`; checkout | 503 `billing_disabled`; `/plans` reports `checkoutEnabled:false` |
| TC-VK-01 | VK page link | Admin posts `https://vk.com/video-…` | 400 with instructions to use the official embed link |
| TC-VK-02 | Rights note | Valid embed link without rights note | 400; with note → stored without `autoplay`/unknown params, playback `kind:'embed'` |
| TC-MIG-01 | Upgrade in place | Create a v1.0 DB (user_version 0) with one title, open with v1.1 | version 2, title kept as `free`, tables present, reopening is a no-op |

## 5. Performance measurement

Tool: autocannon, 50 concurrent connections, 8 s per endpoint, server and load generator on the **same** 2-vCPU sandbox (so numbers are conservative for the server but not a substitute for a real environment), rate limiting disabled for the run, SQLite file DB with the 13-title demo catalog. Re-measured for v1.1.

| Endpoint | Throughput (req/s) | p50 latency | p97.5 latency | Errors / non-2xx | v1.0 for reference |
|---|---|---|---|---|---|
| `GET /api/titles?limit=24` | ≈ 1 080 | 42 ms | 72 ms | 0 | ≈ 1 090 |
| `GET /api/titles?q=orbit` | ≈ 1 250 | 36 ms | 67 ms | 0 | ≈ 1 430 |
| `GET /api/titles?tier=free` | ≈ 1 265 | 37 ms | 61 ms | 0 | – |
| `GET /api/titles/harbor-lights` | ≈ 1 550 | 29 ms | 53 ms | 0 | ≈ 1 390 |
| `GET /api/home` | ≈ 375 | 127 ms | 192 ms | 0 | ≈ 510 |
| `POST /api/playback` (anonymous, free title; includes the view-counter write) | ≈ 1 300 | 35 ms | 68 ms | 0 | – |

Reading: NFR-01 (p95 < 200 ms at 100 req/s) is still met **for this catalog size**, but `/api/home` is the slowest endpoint and got ~25 % slower in v1.1 (one more list query for the *Free to watch* row). It is the first candidate for caching (roadmap v1.3). The signed-in `POST /api/playback` path (session table write inside `BEGIN IMMEDIATE`) was **not** load-tested; SQLite serialises writers, so it is the first write path to watch as concurrent viewers grow. Real-world numbers depend on catalog size (LIKE search is a full scan; move to full-text/trigram beyond a few thousand titles) and hardware. Re-run before launch with production-like data.

## 6. Manual test checklist (before each release)

**Playback (cannot be automated reliably against third-party hosts)**
- [ ] MP4 title plays on Chrome, Firefox, Edge, Safari (macOS) and iOS Safari.
- [ ] HLS (`.m3u8`) title plays: hls.js path on Chrome/Firefox/Edge, native path on Safari/iOS; quality switches on throttled network.
- [ ] Seek works on a real host (confirms the host serves HTTP Range).
- [ ] Source failure shows the "Playback problem" panel; Retry resumes near the previous position.
- [ ] Shortcuts: Space, ←/→, F, M, N (when a next episode exists).
- [ ] **Real VK embed** (needs an owned/licensed video with embedding enabled): plays in VK's player inside the sandboxed iframe on desktop and mobile; a removed/private video shows VK's own error, not a broken page.

**Subscriptions (manual, with the real provider once integrated)**
- [ ] Checkout → webhook → access within seconds; failed payment and refund remove access at the right time.
- [ ] Two devices on a Silver account: second is refused; closing the first frees the slot within ~90 s.
- [ ] Locked states read correctly on phone width (badges, Unlock button, Plans, Account).

**Accessibility (target WCAG 2.1 AA)**
- [ ] Full keyboard walkthrough: skip link, nav, carousel dots, filters, forms, admin table.
- [ ] Screen reader pass (NVDA/VoiceOver): landmarks, form labels, toasts announced, chips expose pressed state.
- [ ] Contrast spot-check (red text on `#141414`, tier badges, muted text); focus ring visible everywhere.
- [ ] 200 % zoom and `prefers-reduced-motion` (no auto-rotating hero, no shimmer, no splash, spinner fades instead of rotating).
- [ ] Motion on a mid-range Android phone and in Safari/Firefox: no jank on Home and Plans, splash not annoying, celebration readable.

**Security**
- [ ] Production deployment serves HTTPS, `COOKIE_SECURE=true`, HSTS present, `JWT_SECRET` unique.
- [ ] Default dev admin does **not** exist in production (`ADMIN_EMAIL`/`ADMIN_PASSWORD` set explicitly).
- [ ] `MEDIA_ORIGINS` restricted to the operator's video hosts.
- [ ] External scan (e.g. OWASP ZAP baseline) shows no high findings.

**Content & legal**
- [ ] Every catalog title has documented distribution rights; demo placeholder titles removed or replaced.
- [ ] Takedown procedure rehearsed (unpublish → verify 404 for anonymous users).

## 7. Known limitations of the test suite

- **L1** HLS playback is not covered by automation (needs a real, reachable HLS source and codec support that headless Chromium lacks for some profiles).
- **L2** Only Chromium is exercised by e2e; Firefox/WebKit are manual.
- **L3** No load test beyond the ad-hoc read-endpoint measurement; no soak test for SQLite WAL growth.
- **L4** Accessibility is checked manually; no automated axe run yet (candidate for v1.1).
- **L5** Docker image build is verified only by the CI job, not in this environment.
- **L6** Withholding video URLs stops casual bypass but not a paying user who copies the URL once issued (test TC-ENT-* prove the checks, not URL secrecy). Signed URLs/DRM are roadmap.
- **L7** Billing is tested against the **demo** provider only. No real payment, webhook signature, renewal, refund or tax behaviour has been exercised.
- **L8** The VK embed is tested against a stub host; the exact `video_ext.php` parameters follow VK's documented embed format but were **not** verified against a live VK video here.
- **L10** *(1.1.1)* Motion is verified structurally (elements, computed styles, running animations, screenshots with animations frozen), **not** visually frame by frame, and only in Chromium. Smoothness on low-end phones, Firefox/Safari rendering of `backdrop-filter`, `:has()` (star hover preview) and `color-mix()`, and frame-rate / battery impact were not measured; see the manual list.
- **L9** Screen-limit tests exercise the API with synthetic client ids; multi-device behaviour on real networks (sleep/wake, flaky connections) is manual.

## 8. Exit criteria for v1.1

- All automated suites green in CI (API, e2e, docker build + health check).
- No open defect of severity High/Critical; known limitations above accepted by the product owner.
- Manual checklist (section 6) signed off on at least Chrome (desktop + Android) and Safari (macOS + iOS).
- Content-rights confirmation in place for every published title, **including a rights note for every VK embed**.
- Before charging real money: a real payment provider integrated, its webhook path tested, `BILLING_PROVIDER` not `mock` in production, prices and plan terms reviewed by the owner (and legal/tax advice obtained).
