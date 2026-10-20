/**
 * End-to-end smoke test (Playwright + Chromium).
 *
 * Boots the real server on a temp database, drives the real UI, and replaces the
 * third-party demo video URLs with a locally generated WebM so playback logic
 * (resume, progress saving, next-episode) is tested without internet access.
 *
 *   cd e2e && npm install && npx playwright install chromium && npm test
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.E2E_PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'movieon-e2e-'));
fs.mkdirSync(OUT, { recursive: true });

// ---- local test video (VP8/Vorbis WebM, 30 s) ----
const videoFile = path.join(OUT, 'clip.webm');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc=duration=30:size=640x360:rate=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
  '-c:v', 'libvpx', '-b:v', '300k', '-g', '24', '-c:a', 'libvorbis', '-shortest', videoFile,
]);
const videoBody = fs.readFileSync(videoFile);

// ---- start the server ----
const dbFile = path.join(OUT, 'e2e.db');
fs.rmSync(dbFile, { force: true });
const server = spawn('node', ['src/index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbFile, NODE_ENV: 'development', ADMIN_EMAIL: 'admin@e2e.local', ADMIN_PASSWORD: 'e2e-admin-pass' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`server did not start:\n${serverLog}`)), 15000);
  const iv = setInterval(() => { if (serverLog.includes('listening')) { clearTimeout(t); clearInterval(iv); resolve(); } }, 100);
});

let passed = 0;
const step = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${e.stack}`); throw e; }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// The intro splash is shown once per browser session; the main run skips it, a dedicated step covers it.
await ctx.addInitScript(() => { try { sessionStorage.setItem('mo_splash', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
// Serve the clip like a real CDN would — including HTTP Range, which browsers need for seeking (resume).
await page.route(/commondatastorage\.googleapis\.com\/.*\.mp4/, (r) => {
  const range = r.request().headers().range;
  const common = { contentType: 'video/webm' };
  if (!range) return r.fulfill({ ...common, status: 200, headers: { 'accept-ranges': 'bytes' }, body: videoBody });
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), videoBody.length - 1) : videoBody.length - 1;
  return r.fulfill({
    ...common,
    status: 206,
    headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${videoBody.length}` },
    body: videoBody.subarray(start, end + 1),
  });
});

// The VK embed host is never contacted from tests.
await page.route(/vkvideo\.ru\/video_ext\.php/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub player</p>' }));

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
const api = (p) => page.evaluate(async (u) => (await fetch(u)).json(), `/api${p}`);

let exitCode = 0;
try {
  await step('home renders hero and rows', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero h1');
    assert.ok((await page.locator('.row').count()) >= 4);
    assert.ok(await page.getByRole('heading', { name: 'Trending now' }).isVisible());
    assert.ok(await page.getByRole('heading', { name: 'Free to watch' }).isVisible());
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(20, 20, 20)');
    await shot('01-home');
  });

  await step('icons: custom SVG set, no emoji or glyph icons anywhere in the UI text', async () => {
    assert.ok((await page.locator('svg.icon').count()) >= 10, 'custom icons are rendered');
    assert.ok((await page.locator('svg.icon[aria-hidden="true"]').count()) === (await page.locator('svg.icon').count()), 'icons are decorative');
    const bad = await page.evaluate(() => (document.body.innerText.match(/[\p{Extended_Pictographic}▶✓★✕●←→‹›]/gu) ?? []).filter((c) => c !== '©'));
    assert.deepEqual(bad, []);
  });

  await step('browse anime + genre filter', async () => {
    await page.getByRole('link', { name: 'Anime', exact: true }).first().click();
    await page.waitForFunction(() => location.hash.includes('type=anime'));
    await page.waitForSelector('.grid:not([aria-busy]) a.card');
    const before = await page.locator('a.card').count();
    assert.ok(before >= 3);
    await page.getByRole('button', { name: 'Action', exact: true }).click();
    await page.waitForFunction(() => location.hash.includes('genre=Action'));
    await page.waitForSelector('.grid:not([aria-busy]) a.card');
    assert.ok((await page.locator('a.card').count()) <= before);
    await shot('02-browse-anime');
  });

  await step('browse: Free filter shows only free titles', async () => {
    await page.goto(`${BASE}/#/browse?tier=free`);
    await page.waitForSelector('.grid:not([aria-busy]) a.card');
    const labels = await page.locator('a.card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    assert.ok(labels.length >= 5);
    assert.ok(labels.every((l) => l.endsWith(', free')), labels.join(' | '));
    await shot('02b-browse-free');
  });

  await step('search finds Orbit Station', async () => {
    await page.fill('#search-input', 'orbit');
    await page.press('#search-input', 'Enter');
    await page.waitForSelector('a.card:has-text("Orbit Station")');
  });

  await step('register signs the user in', async () => {
    await page.goto(`${BASE}/#/register`);
    await page.fill('#email', 'viewer@e2e.local');
    await page.fill('#username', 'Viewer One');
    await page.fill('#password', 'viewer-pass-123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForSelector('#account :text("Viewer One")');
  });

  await step('title page: details, watchlist, rating', async () => {
    await page.goto(`${BASE}/#/title/orbit-station`);
    await page.waitForSelector('h1:has-text("Orbit Station")');
    assert.equal(await page.locator('.ep').count(), 4);
    assert.ok(await page.getByRole('link', { name: /Unlock with Gold/ }).isVisible(), 'locked title shows the upgrade CTA');
    await page.getByRole('button', { name: 'My List', exact: true }).click();
    await page.waitForSelector('button:has-text("In My List")');
    await page.getByRole('button', { name: '4 stars' }).click();
    await page.waitForSelector('.avg:has-text("4.0")');
    await page.mouse.move(640, 10); // park the pointer so no hover state leaks into the screenshot
    await shot('03-title');
  });

  await step('watchlist page lists the title', async () => {
    await page.getByRole('link', { name: 'My List' }).click();
    await page.waitForSelector('a.card:has-text("Orbit Station")');
  });

  await step('player: plays, saves progress, resumes', async () => {
    await page.goto(`${BASE}/#/title/kitchen-wars`);
    await page.getByRole('link', { name: /^Play S1 · E1/ }).click();
    await page.waitForSelector('video');
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 6, null, { timeout: 30000 });
    await shot('04-watch');
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForTimeout(600);
    const prog = await api('/progress');
    assert.equal(prog.items.length, 1);
    assert.equal(prog.items[0].slug, 'kitchen-wars');
    assert.ok(prog.items[0].position > 5);

    // home shows Continue watching
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('h2:has-text("Continue watching")');

    // resume: reopen the episode, playback should start near the saved position
    await page.goto(`${BASE}/#/watch/kitchen-wars?ep=${prog.items[0].episode.id}`);
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 1, null, { timeout: 20000 });
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(t >= prog.items[0].position - 1, `resumed at ${t}, saved ${prog.items[0].position}`);
  });

  await step('player: next-episode overlay and Play now', async () => {
    await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = v.duration - 0.4; });
    await page.waitForSelector('.player-overlay:has-text("Up next")', { timeout: 15000 });
    await shot('05-next-episode');
    await page.getByRole('button', { name: 'Play now' }).click();
    await page.waitForFunction(() => location.hash.includes('ep='));
    await page.waitForSelector('h2:has-text("E2")');
  });

  await step('player: keyboard shortcut M toggles mute', async () => {
    await page.waitForSelector('video');
    await page.locator('h1').first().click();
    const before = await page.evaluate(() => document.querySelector('video').muted);
    await page.keyboard.press('m');
    assert.equal(await page.evaluate(() => document.querySelector('video').muted), !before);
  });

  await step('gated title: server refuses playback and the player explains why', async () => {
    const detail = await page.evaluate(async () => (await fetch('/api/titles/orbit-station')).text());
    assert.ok(!/googleapis|\.mp4|\.m3u8/.test(detail), 'public payload must not contain video URLs');
    await page.goto(`${BASE}/#/watch/orbit-station`);
    await page.waitForSelector('.player-overlay:has-text("Included with Gold")');
    assert.equal(await page.locator('video').evaluate((v) => v.currentSrc || v.getAttribute('src') || ''), '');
    await shot('05b-locked');
  });

  await step('plans page → demo checkout → Gold unlocks the title', async () => {
    await page.getByRole('link', { name: 'See plans' }).click();
    await page.waitForSelector('.plan-diamond');
    assert.equal(await page.locator('.plan').count(), 4);
    await shot('05c-plans');
    await page.getByRole('link', { name: 'Choose Gold' }).click();
    await page.waitForSelector('h1:has-text("Confirm your plan")');
    assert.equal(await page.locator('input[type=text], input[autocomplete^="cc-"]').count(), 0, 'no card fields in demo checkout');
    await page.getByRole('button', { name: /Confirm and pay \$8\.99/ }).click();
    await page.waitForSelector('.celebrate .cel-tick');
    await shot('05c2-celebrate').catch(() => {});
    await page.waitForSelector('h1:has-text("Account")');
    await page.waitForSelector('#sub-status:has-text("Active")');
    assert.ok(await page.locator('#account .tier-gold').isVisible());
    await page.waitForSelector('td:has-text("(demo)")');
    await shot('05d-account');

    await page.goto(`${BASE}/#/title/orbit-station`);
    await page.getByRole('link', { name: /^(Continue|Play) S1 · E1/ }).click();
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 2, null, { timeout: 30000 });
  });

  await step('cancel keeps access until period end; resume restores', async () => {
    await page.goto(`${BASE}/#/account`);
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    await page.waitForSelector('#sub-status:has-text("Canceled")');
    await page.getByRole('button', { name: 'Resume subscription' }).click();
    await page.waitForSelector('#sub-status:has-text("Active")');
  });

  await step('sign out; admin signs in and manages catalog', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('a:has-text("Sign in")');
    assert.equal(await page.locator('#admin-link').isHidden(), true);

    await page.goto(`${BASE}/#/login?next=/admin`);
    await page.fill('#email', 'admin@e2e.local');
    await page.fill('#password', 'e2e-admin-pass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.waitForSelector('h1:has-text("Admin")');

    await page.fill('#new-name', 'E2E Movie');
    await page.fill('#new-video', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/e2e.mp4');
    await page.fill('#new-genres', 'Drama, Test');
    await page.getByRole('button', { name: 'Create title' }).click();
    await page.waitForSelector('td:has-text("E2E Movie")');
    await shot('06-admin');

    await page.goto(`${BASE}/#/title/e2e-movie`);
    await page.waitForSelector('h1:has-text("E2E Movie")');

    // VK: page links are refused, official embeds need a rights note, then play in a sandboxed iframe
    await page.goto(`${BASE}/#/admin`);
    await page.fill('#new-name', 'VK Demo');
    await page.fill('#new-video', 'https://vk.com/video-227034863_456239527');
    await page.getByRole('button', { name: 'Create title' }).click();
    await page.waitForSelector('.form-error:has-text("embed")');
    await page.fill('#new-video', 'https://vkvideo.ru/video_ext.php?oid=-227034863&id=456239527&hash=99fae216cf20dcdc');
    await page.getByRole('button', { name: 'Create title' }).click();
    await page.waitForSelector('.form-error:has-text("ights note")');
    await page.fill('#new-rights', 'Own channel, embedding enabled');
    await page.getByRole('button', { name: 'Create title' }).click();
    await page.waitForSelector('td:has-text("VK Demo")');
    await page.goto(`${BASE}/#/watch/vk-demo`);
    await page.waitForSelector('iframe.embed-frame[src^="https://vkvideo.ru/video_ext.php"]');
    assert.ok(await page.locator('iframe.embed-frame').getAttribute('sandbox'));
    await page.waitForSelector('.save-hint:has-text("VK")');
    await shot('06b-vk-embed');

    await page.goto(`${BASE}/#/admin`);
    await page.waitForSelector('td:has-text("E2E Movie")');
    await page.locator('tr:has-text("E2E Movie")').getByRole('button', { name: 'Delete' }).click();
    await page.waitForSelector('td:has-text("E2E Movie")', { state: 'detached' });
    await page.locator('tr:has-text("VK Demo")').getByRole('button', { name: 'Delete' }).click();
    await page.waitForSelector('td:has-text("VK Demo")', { state: 'detached' });
  });

  await step('mobile viewport has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const hash of ['/', '/browse?type=movie', '/title/sintel']) {
      await page.goto(`${BASE}/#${hash}`);
      await page.waitForSelector('main h1, main h2');
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${hash} overflows by ${overflow}px`);
    }
    await shot('07-mobile-title');
  });

  await step('design is dark red/black regardless of OS preference; no theme toggle', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const c = await browser.newContext({ colorScheme, viewport: { width: 1280, height: 800 } });
      const p = await c.newPage();
      await p.goto(`${BASE}/`);
      await p.waitForSelector('.hero h1');
      assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(20, 20, 20)');
      assert.equal(await p.getByRole('button', { name: /theme/i }).count(), 0);
      const btn = await p.locator('.site-header .btn.small:not(.ghost)').first().evaluate((e) => getComputedStyle(e).backgroundColor);
      assert.equal(btn, 'rgb(229, 9, 20)');
      if (colorScheme === 'light') await p.screenshot({ path: path.join(OUT, '08-home-os-light.png') });
      await c.close();
    }
  });

  await step('animations: splash once per session, entrance + hover motion present', async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(`${BASE}/`);
    await p.waitForSelector('.splash');
    assert.equal(await p.locator('.splash-mark span').count(), 7, 'MOVIEON drawn letter by letter');
    await p.waitForSelector('.hero h1');
    await p.waitForSelector('.splash.out', { timeout: 6000 });
    await p.waitForSelector('.splash', { state: 'detached', timeout: 6000 });
    await p.reload();
    await p.waitForSelector('.hero h1');
    assert.equal(await p.locator('.splash').count(), 0, 'splash is not shown again in the same session');
    // entrance animation on cards, route bar element, scrolled header, ripple
    assert.notEqual(await p.locator('.row .enter').first().evaluate((e) => getComputedStyle(e).animationName), 'none');
    await p.evaluate(() => window.scrollTo(0, 400));
    await p.waitForSelector('#header.scrolled');
    await p.goto(`${BASE}/#/browse?type=movie`);
    await p.waitForSelector('.grid:not([aria-busy]) a.card');
    const hover = p.locator('a.card').first();
    await hover.hover();
    await p.waitForTimeout(450);
    assert.equal(await hover.locator('.poster-cta').evaluate((e) => getComputedStyle(e).opacity), '1', 'play button fades in on hover');
    const chip = p.locator('.chip').first();
    const bb = await chip.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await p.mouse.down();
    assert.ok((await chip.locator('.ripple').count()) >= 1, 'ripple on press');
    await p.mouse.up();
    assert.deepEqual(errs, []);
    await c.close();
  });

  await step('prefers-reduced-motion: no splash, no running animations', async () => {
    const c = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    const p = await c.newPage();
    await p.goto(`${BASE}/`);
    await p.waitForSelector('.hero h1');
    assert.equal(await p.locator('.splash').count(), 0);
    const running = await p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming().iterations === Infinity && a.playState === 'running').length);
    assert.equal(running, 0, 'no infinite animations');
    assert.equal(await p.locator('.row .enter').first().evaluate((e) => getComputedStyle(e).animationName), 'none');
    await c.close();
  });

  await step('no CSP violations or script errors in the console', async () => {
    const real = problems.filter((p) => !/Failed to load resource/.test(p));
    assert.deepEqual(real, []);
  });

  console.log(`\nE2E: ${passed} steps passed. Screenshots: ${OUT}`);
} catch {
  exitCode = 1;
  await shot('failure').catch(() => {});
  console.error('\nBrowser problems:', problems);
  console.error('Server log:\n' + serverLog.split('\n').slice(-15).join('\n'));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
process.exit(exitCode);
