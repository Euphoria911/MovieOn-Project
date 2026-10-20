import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { boot, registerUser, loginAdmin, grant, newClientId } from './helpers.js';
import { openDb, MIGRATIONS, SCHEMA_VERSION } from '../src/db.js';

let app;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

/** Signed-in client, optionally with a plan. */
async function viewer(plan) {
  const c = app.client();
  const u = await registerUser(c);
  if (plan) grant(app.db, u.email, plan);
  return { c, u };
}
const title = async (c, slug) => (await c.get(`/api/titles/${slug}`)).json;
const play = (c, t, extra = {}) => c.post('/api/playback', { titleId: t.id, clientId: newClientId(), ...extra });

describe('plans', () => {
  test('GET /api/plans lists Silver < Gold < Diamond with growing price, screens and level', async () => {
    const r = await app.client().get('/api/plans');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.plans.map((p) => p.id), ['silver', 'gold', 'diamond']);
    const p = r.json.plans;
    assert.ok(p[0].priceCents < p[1].priceCents && p[1].priceCents < p[2].priceCents);
    assert.deepEqual(p.map((x) => x.screens), [1, 2, 4]);
    assert.equal(r.json.checkoutEnabled, true);
  });

  test('/api/auth/me reports access level and plan', async () => {
    const { c } = await viewer('gold');
    const me = (await c.get('/api/auth/me')).json;
    assert.equal(me.access.level, 2);
    assert.equal(me.access.plan, 'gold');
    assert.equal(me.access.screens, 2);
    const anon = (await app.client().get('/api/auth/me')).json;
    assert.equal(anon.access.level, 0);
  });
});

describe('tier gating at playback', () => {
  test('anonymous: free title plays (no session), paid title → 401 login_required', async () => {
    const c = app.client();
    const free = await c.post('/api/playback', { titleId: (await title(c, 'big-buck-bunny')).id });
    assert.equal(free.status, 200);
    assert.equal(free.json.sessionId, null);
    assert.equal(free.json.source.kind, 'file');
    assert.match(free.json.source.url, /^https:\/\//);

    const gold = await c.post('/api/playback', { titleId: (await title(c, 'sakura-circuit')).id });
    assert.equal(gold.status, 401);
    assert.equal(gold.json.code, 'login_required');
    assert.equal(gold.json.requiredTier, 'gold');
  });

  test('plan ladder: each plan unlocks its own tier and below, never above', async () => {
    const free = await viewer();
    const silver = await viewer('silver');
    const gold = await viewer('gold');
    const diamond = await viewer('diamond');
    const probe = app.client();
    const tiers = {
      free: await title(probe, 'big-buck-bunny'),
      silver: await title(probe, 'midnight-courier'),
      gold: await title(probe, 'iron-aegis'),
      diamond: await title(probe, 'blade-of-the-tide'),
    };
    const pick = async (t) => {
      if (t.type === 'movie') return {};
      const d = await title(probe, t.slug);
      return { episodeId: d.episodes[0].id };
    };
    const expectations = [
      [free, [200, 403, 403, 403]],
      [silver, [200, 200, 403, 403]],
      [gold, [200, 200, 200, 403]],
      [diamond, [200, 200, 200, 200]],
    ];
    for (const [v, expected] of expectations) {
      const got = [];
      const clientId = newClientId(); // one tab: each new start replaces its previous session, so the screen limit is not hit
      for (const t of Object.values(tiers)) got.push((await play(v.c, t, { ...(await pick(t)), clientId })).status);
      assert.deepEqual(got, expected);
    }
  });

  test('403 carries a machine-readable code for the upgrade prompt', async () => {
    const { c } = await viewer();
    const gold = await title(c, 'sakura-circuit');
    const d = await title(c, gold.slug);
    const r = await play(c, gold, { episodeId: d.episodes[0].id });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'upgrade_required');
    assert.equal(r.json.requiredTier, 'gold');
    assert.equal((await title(c, 'sakura-circuit')).canWatch, false);
  });

  test('admins can play every tier (QA access)', async () => {
    const a = app.client();
    await loginAdmin(a);
    assert.equal((await play(a, await title(a, 'blade-of-the-tide'), {
      episodeId: (await title(a, 'blade-of-the-tide')).episodes[0].id,
    })).status, 200);
  });

  test('playback validates input', async () => {
    const { c } = await viewer('diamond');
    const series = await title(c, 'orbit-station');
    assert.equal((await c.post('/api/playback', { titleId: series.id, clientId: newClientId() })).status, 400); // no episode
    assert.equal((await c.post('/api/playback', { titleId: series.id, episodeId: 99999, clientId: newClientId() })).status, 404);
    const movie = await title(c, 'big-buck-bunny');
    assert.equal((await c.post('/api/playback', { titleId: movie.id })).status, 400); // clientId required when signed in
    assert.equal((await c.post('/api/playback', { titleId: movie.id, clientId: 'bad id!' })).status, 400);
  });
});

describe('checkout and subscription lifecycle', () => {
  test('requires auth, validates plan', async () => {
    assert.equal((await app.client().post('/api/billing/checkout', { plan: 'gold' })).status, 401);
    const { c } = await viewer();
    assert.equal((await c.post('/api/billing/checkout', { plan: 'platinum' })).status, 400);
    assert.equal((await c.post('/api/billing/checkout', {})).status, 400);
  });

  test('subscribe → unlock → upgrade → history; same plan twice → 409', async () => {
    const { c } = await viewer();
    const gold = await title(c, 'orbit-station');
    const ep = gold.episodes[0].id;
    assert.equal((await play(c, gold, { episodeId: ep })).status, 403);

    let r = await c.post('/api/billing/checkout', { plan: 'silver' });
    assert.equal(r.status, 201);
    assert.equal(r.json.subscription.plan, 'silver');
    assert.equal(r.json.subscription.active, true);
    assert.ok(r.json.subscription.daysLeft >= 29);
    assert.equal((await c.post('/api/billing/checkout', { plan: 'silver' })).status, 409);
    assert.equal((await play(c, gold, { episodeId: ep })).status, 403); // silver < gold

    r = await c.post('/api/billing/checkout', { plan: 'gold' });
    assert.equal(r.status, 201);
    assert.equal(r.json.access.level, 2);
    assert.equal((await play(c, gold, { episodeId: ep })).status, 200);

    const sub = (await c.get('/api/billing/subscription')).json;
    assert.equal(sub.access.plan, 'gold');
    assert.equal(sub.payments.length, 2);
    assert.deepEqual(sub.payments.map((p) => p.plan), ['gold', 'silver']);
    assert.equal(sub.payments[0].amountCents, 899);
    assert.ok(!JSON.stringify(sub).match(/\d{12,}/), 'no card-like numbers are ever stored or returned');
  });

  test('cancel keeps access until the period ends; resume restores; expiry removes access', async () => {
    const { c, u } = await viewer();
    await c.post('/api/billing/checkout', { plan: 'silver' });
    const silver = await title(c, 'midnight-courier');

    const canceled = await c.post('/api/billing/cancel');
    assert.equal(canceled.json.subscription.status, 'canceled');
    assert.equal(canceled.json.subscription.active, true);
    assert.equal((await play(c, silver)).status, 200);

    assert.equal((await c.post('/api/billing/resume')).json.subscription.status, 'active');
    assert.equal((await c.post('/api/billing/resume')).status, 409); // nothing to resume

    // simulate the period running out
    app.db.prepare(
      "UPDATE subscriptions SET current_period_end = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    ).run(new Date(Date.now() - 1000).toISOString(), u.email.toLowerCase());
    assert.equal((await c.get('/api/auth/me')).json.access.level, 0);
    assert.equal((await play(c, silver)).status, 403);
    assert.equal((await c.post('/api/billing/cancel')).status, 404);
    const sub = (await c.get('/api/billing/subscription')).json;
    assert.equal(sub.subscription.active, false);
  });

  test('checkout is disabled (503) when no billing provider is configured', async () => {
    const off = await boot({ billingProvider: 'none' });
    try {
      const c = off.client();
      await registerUser(c);
      const r = await c.post('/api/billing/checkout', { plan: 'gold' });
      assert.equal(r.status, 503);
      assert.equal(r.json.code, 'billing_disabled');
      assert.equal((await c.get('/api/plans')).json.checkoutEnabled, false);
    } finally { await off.close(); }
  });

  test('admin can grant and revoke subscriptions; users cannot', async () => {
    const { c, u } = await viewer();
    assert.equal((await c.post('/api/admin/subscriptions', { email: u.email, plan: 'diamond' })).status, 403);

    const a = app.client();
    await loginAdmin(a);
    assert.equal((await a.post('/api/admin/subscriptions', { email: 'nobody@test.local', plan: 'gold' })).status, 404);
    assert.equal((await a.post('/api/admin/subscriptions', { email: u.email, plan: 'bronze' })).status, 400);
    assert.equal((await a.post('/api/admin/subscriptions', { email: u.email, plan: 'diamond', days: 10 })).status, 201);
    assert.equal((await c.get('/api/auth/me')).json.access.plan, 'diamond');
    assert.equal((await a.post('/api/admin/subscriptions/revoke', { email: u.email })).status, 200);
    assert.equal((await c.get('/api/auth/me')).json.access.level, 0);
  });
});

describe('simultaneous screens', () => {
  test('free/silver: 1 screen; a tab replaces its own session; stop frees the slot', async () => {
    const { c } = await viewer('silver');
    const t = await title(c, 'midnight-courier');
    const tabA = newClientId();
    const tabB = newClientId();

    const a1 = await c.post('/api/playback', { titleId: t.id, clientId: tabA });
    assert.equal(a1.status, 200);
    const blocked = await c.post('/api/playback', { titleId: t.id, clientId: tabB });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'screen_limit');
    assert.equal(blocked.json.screens, 1);

    // same tab starting again replaces its previous session
    const a2 = await c.post('/api/playback', { titleId: t.id, clientId: tabA });
    assert.equal(a2.status, 200);
    assert.notEqual(a2.json.sessionId, a1.json.sessionId);

    assert.equal((await c.del(`/api/playback/${a2.json.sessionId}`)).status, 200);
    assert.equal((await c.post('/api/playback', { titleId: t.id, clientId: tabB })).status, 200);
  });

  test('gold allows 2 screens, third is refused; diamond allows 4', async () => {
    const gold = await viewer('gold');
    const t = await title(gold.c, 'big-buck-bunny');
    assert.equal((await gold.c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 200);
    assert.equal((await gold.c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 200);
    const third = await gold.c.post('/api/playback', { titleId: t.id, clientId: newClientId() });
    assert.equal(third.status, 403);
    assert.equal(third.json.screens, 2);

    const dia = await viewer('diamond');
    for (let i = 0; i < 4; i++) {
      assert.equal((await dia.c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 200);
    }
    assert.equal((await dia.c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 403);
  });

  test('stale sessions (no heartbeat for 90 s) stop counting', async () => {
    const { c } = await viewer('silver');
    const t = await title(c, 'big-buck-bunny');
    const first = await c.post('/api/playback', { titleId: t.id, clientId: newClientId() });
    assert.equal((await c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 403);
    app.db.prepare('UPDATE playback_sessions SET last_seen = ? WHERE id = ?').run(Date.now() - 120_000, first.json.sessionId);
    assert.equal((await c.post('/api/playback', { titleId: t.id, clientId: newClientId() })).status, 200);
  });

  test('heartbeat keeps a session alive; unknown/expired → 404; lapsed subscription → 403 and stops', async () => {
    const { c, u } = await viewer('silver');
    const t = await title(c, 'midnight-courier');
    const s = await c.post('/api/playback', { titleId: t.id, clientId: newClientId() });
    assert.equal((await c.post(`/api/playback/${s.json.sessionId}/heartbeat`)).status, 200);

    const unknown = await c.post('/api/playback/00000000-0000-0000-0000-000000000000/heartbeat');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.code, 'session_expired');

    app.db.prepare('UPDATE subscriptions SET current_period_end = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .run(new Date(Date.now() - 1000).toISOString(), u.email.toLowerCase());
    const lapsed = await c.post(`/api/playback/${s.json.sessionId}/heartbeat`);
    assert.equal(lapsed.status, 403);
    assert.equal(lapsed.json.code, 'upgrade_required');
    assert.equal(app.db.prepare('SELECT COUNT(*) c FROM playback_sessions WHERE id = ?').get(s.json.sessionId).c, 0);
  });

  test("a user cannot heartbeat or end someone else's session", async () => {
    const a = await viewer('silver');
    const b = await viewer('silver');
    const t = await title(a.c, 'big-buck-bunny');
    const s = await a.c.post('/api/playback', { titleId: t.id, clientId: newClientId() });
    assert.equal((await b.c.post(`/api/playback/${s.json.sessionId}/heartbeat`)).status, 404);
    await b.c.del(`/api/playback/${s.json.sessionId}`);
    assert.equal(app.db.prepare('SELECT COUNT(*) c FROM playback_sessions WHERE id = ?').get(s.json.sessionId).c, 1);
  });
});

describe('admin: tiers and tier filter', () => {
  test('create/update minTier; catalog ?tier= filter; invalid tier → 400', async () => {
    const a = app.client();
    await loginAdmin(a);
    const t = (await a.post('/api/admin/titles', {
      type: 'movie', name: 'Tier Test', videoUrl: 'https://example.com/t.mp4', minTier: 'gold',
    })).json.title;
    assert.equal(t.minTier, 'gold');
    assert.equal((await a.post('/api/admin/titles', { type: 'movie', name: 'x', minTier: 'platinum' })).status, 400);

    const anon = app.client();
    const golds = (await anon.get('/api/titles?tier=gold&limit=50')).json.items;
    assert.ok(golds.some((x) => x.id === t.id));
    assert.ok(golds.every((x) => x.minTier === 'gold'));
    assert.equal((await anon.get('/api/titles?tier=platinum')).status, 400);

    const up = await a.put(`/api/admin/titles/${t.id}`, { minTier: 'free' });
    assert.equal(up.json.title.minTier, 'free');
    const home = (await anon.get('/api/home')).json;
    assert.ok(home.rows.find((r) => r.key === 'free').items.every((x) => x.minTier === 'free'));
  });
});

describe('VK embed sources (official embed player only)', () => {
  const EMBED = 'https://vkvideo.ru/video_ext.php?oid=-227034863&id=456239527&hash=99fae216cf20dcdc';
  const base = { type: 'movie', name: 'Embed Movie' };

  test('VK page links are rejected with guidance (no stream extraction)', async () => {
    const a = app.client();
    await loginAdmin(a);
    for (const url of ['https://vk.com/video-227034863_456239527', 'https://vkvideo.ru/video-1_2', 'http://vk.com/video_ext.php?oid=1&id=2']) {
      const r = await a.post('/api/admin/titles', { ...base, videoUrl: url, rightsNote: 'we own it' });
      assert.equal(r.status, 400, url);
      assert.match(r.json.error, /embed/i);
    }
  });

  test('embed requires a rights note; with one it is stored normalised and served as kind=embed', async () => {
    const a = app.client();
    await loginAdmin(a);
    const noNote = await a.post('/api/admin/titles', { ...base, videoUrl: EMBED });
    assert.equal(noNote.status, 400);
    assert.match(noNote.json.error, /rights note/i);

    const created = await a.post('/api/admin/titles', {
      ...base, name: 'Embed Movie 2', rightsNote: 'Own channel; embedding enabled',
      videoUrl: `${EMBED}&autoplay=1&js_api=1&evil=1`,
    });
    assert.equal(created.status, 201);
    const list = (await a.get('/api/admin/titles')).json.items.find((x) => x.id === created.json.title.id);
    assert.equal(list.sourceKind, 'embed');
    assert.equal(list.videoUrl, EMBED); // extra params stripped
    assert.equal(list.rightsNote, 'Own channel; embedding enabled');

    const pb = await a.post('/api/playback', { titleId: list.id, clientId: newClientId() });
    assert.equal(pb.status, 200);
    assert.equal(pb.json.source.kind, 'embed');
    assert.equal(pb.json.source.url, EMBED);
  });

  test('malformed embeds are rejected; non-VK hosts are treated as plain file URLs', async () => {
    const a = app.client();
    await loginAdmin(a);
    const bad = (url) => a.post('/api/admin/titles', { ...base, videoUrl: url, rightsNote: 'ok ok' });
    assert.equal((await bad('https://vkvideo.ru/video_ext.php?oid=abc&id=1')).status, 400);
    assert.equal((await bad('https://vkvideo.ru/video_ext.php?oid=1&id=2&hash=zz!')).status, 400);
    const other = await a.post('/api/admin/titles', { ...base, name: 'Other host', videoUrl: 'https://evil.example/video_ext.php?oid=1&id=2' });
    assert.equal(other.status, 201); // plain file URL on an unrelated host: no embed, no iframe
    const row = (await a.get('/api/admin/titles')).json.items.find((x) => x.id === other.json.title.id);
    assert.equal(row.sourceKind, 'file');
  });

  test('episode embeds need the parent title rights note', async () => {
    const a = app.client();
    await loginAdmin(a);
    const t = (await a.post('/api/admin/titles', { type: 'series', name: 'Embed Series', status: 'draft' })).json.title;
    const ep = { season: 1, number: 1, name: 'Pilot', videoUrl: EMBED };
    assert.equal((await a.post(`/api/admin/titles/${t.id}/episodes`, ep)).status, 400);
    await a.put(`/api/admin/titles/${t.id}`, { rightsNote: 'Licensed from X, embed allowed' });
    assert.equal((await a.post(`/api/admin/titles/${t.id}/episodes`, ep)).status, 201);
    const eps = (await a.get(`/api/admin/titles/${t.id}/episodes`)).json.items;
    assert.equal(eps[0].sourceKind, 'embed');
  });

  test('CSP allows framing only the VK embed hosts', async () => {
    const csp = (await app.client().get('/api/health')).headers.get('content-security-policy');
    const m = /frame-src ([^;]+)/.exec(csp);
    assert.ok(m, 'frame-src present');
    assert.deepEqual(m[1].split(' ').sort(), ['https://vk.com', 'https://vk.ru', 'https://vkvideo.ru']);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});

describe('database migrations', () => {
  test('a v1.0 database is upgraded in place and keeps its data', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mo-mig-')), 'old.db');
    const old = new Database(file);
    old.exec(MIGRATIONS[0]); // exactly what v1.0 created (user_version stays 0)
    old.prepare("INSERT INTO titles (slug, type, name) VALUES ('legacy', 'movie', 'Legacy')").run();
    assert.equal(old.pragma('user_version', { simple: true }), 0);
    old.close();

    const db = openDb(file);
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    const row = db.prepare("SELECT name, min_tier, rights_note FROM titles WHERE slug = 'legacy'").get();
    assert.deepEqual({ ...row }, { name: 'Legacy', min_tier: 'free', rights_note: '' });
    db.close();
    // idempotent on reopen
    const again = openDb(file);
    assert.equal(again.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    again.close();
  });
});
