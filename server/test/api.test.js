import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, registerUser, loginAdmin } from './helpers.js';

let app;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

describe('health & plumbing', () => {
  test('GET /api/health', async () => {
    const r = await app.client().get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
  });

  test('unknown API path returns JSON 404', async () => {
    const r = await app.client().get('/api/nope');
    assert.equal(r.status, 404);
    assert.ok(r.json.error);
  });

  test('malformed JSON returns 400', async () => {
    const r = await app.client().call('POST', '/api/auth/login', '{bad json');
    assert.equal(r.status, 400);
  });

  test('security headers: strict CSP, nosniff, no x-powered-by', async () => {
    const r = await app.client().get('/api/health');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('cross-origin state-changing request is blocked', async () => {
    const r = await app.client().post(
      '/api/auth/login', { email: 'a@b.co', password: 'x' }, { Origin: 'http://evil.example' },
    );
    assert.equal(r.status, 403);
  });
});

describe('FR-01/02 auth', () => {
  test('register validation', async () => {
    const c = app.client();
    assert.equal((await c.post('/api/auth/register', { email: 'bad', username: 'ab', password: 'password123' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { email: 'x@y.co', username: 'ab', password: 'short' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { email: 'x@y.co', username: '<b>', password: 'password123' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { email: 'x@y.co', username: 'a', password: 'password123' })).status, 400);
  });

  test('register → cookie flags → me → logout', async () => {
    const c = app.client();
    const u = await c.post('/api/auth/register', { email: 'Reg@Test.local', username: 'Reg', password: 'password123' });
    assert.equal(u.status, 201);
    assert.equal(u.json.user.email, 'reg@test.local');
    assert.equal(u.json.user.role, 'user');
    assert.equal(u.json.user.password_hash, undefined);
    const sc = u.headers.getSetCookie()[0];
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Strict/i);

    assert.equal((await c.get('/api/auth/me')).json.user.username, 'Reg');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).json.user, null);
  });

  test('duplicate email → 409', async () => {
    const c = app.client();
    const body = { email: 'dup@test.local', username: 'Dup', password: 'password123' };
    assert.equal((await c.post('/api/auth/register', body)).status, 201);
    assert.equal((await app.client().post('/api/auth/register', body)).status, 409);
  });

  test('login: wrong password and unknown email give the same message', async () => {
    const c = app.client();
    const u = await registerUser(c);
    const wrong = await app.client().post('/api/auth/login', { email: u.email, password: 'wrongwrong' });
    const unknown = await app.client().post('/api/auth/login', { email: 'ghost@test.local', password: 'wrongwrong' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error, unknown.json.error);
    const ok = await app.client().post('/api/auth/login', { email: u.email, password: u.password });
    assert.equal(ok.status, 200);
  });

  test('tampered cookie is treated as anonymous', async () => {
    const r = await app.client().get('/api/auth/me', { cookie: 'mo_token=abc.def.ghi' });
    assert.equal(r.json.user, null);
  });
});

describe('FR-03..06 catalog', () => {
  test('list returns paginated items without video URLs', async () => {
    const r = await app.client().get('/api/titles?limit=5');
    assert.equal(r.status, 200);
    assert.equal(r.json.items.length, 5);
    assert.ok(r.json.total >= 10);
    assert.equal(r.json.items[0].videoUrl, undefined);
    assert.ok(Array.isArray(r.json.items[0].genres));
  });

  test('pagination covers disjoint pages', async () => {
    const c = app.client();
    const p1 = (await c.get('/api/titles?limit=4&page=1')).json;
    const p2 = (await c.get('/api/titles?limit=4&page=2')).json;
    const ids1 = new Set(p1.items.map((i) => i.id));
    assert.ok(p2.items.every((i) => !ids1.has(i.id)));
    assert.equal(p1.pages, Math.ceil(p1.total / 4));
  });

  test('filter by type', async () => {
    const r = await app.client().get('/api/titles?type=anime&limit=50');
    assert.ok(r.json.items.length >= 3);
    assert.ok(r.json.items.every((i) => i.type === 'anime'));
  });

  test('filter by genre is case-insensitive and combines with type', async () => {
    const r = await app.client().get('/api/titles?type=anime&genre=action&limit=50');
    assert.ok(r.json.items.length >= 1);
    assert.ok(r.json.items.every((i) => i.type === 'anime' && i.genres.some((g) => g.toLowerCase() === 'action')));
  });

  test('search by name and synopsis; empty result is valid', async () => {
    const c = app.client();
    const a = await c.get('/api/titles?q=bunny');
    assert.ok(a.json.items.some((i) => i.name === 'Big Buck Bunny'));
    const b = await c.get('/api/titles?q=lighthouse');
    assert.ok(b.json.items.some((i) => i.name === 'Harbor Lights'));
    const none = await c.get('/api/titles?q=zzzzqqqq');
    assert.equal(none.json.total, 0);
    assert.deepEqual(none.json.items, []);
  });

  test('LIKE wildcards in the query are treated literally', async () => {
    const r = await app.client().get('/api/titles?q=%25');
    assert.equal(r.json.total, 0);
  });

  test('SQL injection attempts do not break anything', async () => {
    const c = app.client();
    const r1 = await c.get(`/api/titles?q=${encodeURIComponent("' OR 1=1; DROP TABLE titles;--")}`);
    assert.equal(r1.status, 200);
    const r2 = await c.get(`/api/titles?genre=${encodeURIComponent("x' OR '1'='1")}`);
    assert.equal(r2.status, 200);
    assert.equal(r2.json.total, 0);
    assert.ok((await c.get('/api/titles')).json.total >= 10);
  });

  test('sort by name is ascending', async () => {
    const r = await app.client().get('/api/titles?sort=name&limit=50');
    const names = r.json.items.map((i) => i.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());
  });

  test('invalid query params → 400', async () => {
    const c = app.client();
    assert.equal((await c.get('/api/titles?type=podcast')).status, 400);
    assert.equal((await c.get('/api/titles?sort=random')).status, 400);
    assert.equal((await c.get('/api/titles?limit=1000')).status, 400);
    assert.equal((await c.get('/api/titles?page=0')).status, 400);
  });

  test('detail payload never exposes video URLs; series episodes are ordered', async () => {
    const c = app.client();
    const m = await c.get('/api/titles/big-buck-bunny');
    assert.equal(m.status, 200);
    assert.equal(m.json.videoUrl, undefined);
    assert.equal(m.json.hasSource, true);
    assert.equal(m.json.canWatch, true);
    assert.deepEqual(m.json.episodes, []);

    const s = await c.get('/api/titles/harbor-lights');
    assert.equal(s.json.videoUrl, undefined);
    assert.equal(s.json.episodes.length, 5);
    assert.ok(s.json.episodes.every((e) => e.videoUrl === undefined));
    assert.equal(s.json.canWatch, false); // silver title, anonymous viewer
    const keys = s.json.episodes.map((e) => e.season * 100 + e.number);
    assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
    assert.ok(!JSON.stringify(s.json).includes('http'), 'no URLs anywhere in the payload');
  });

  test('unknown slug → 404', async () => {
    assert.equal((await app.client().get('/api/titles/does-not-exist')).status, 404);
  });

  test('genres endpoint lists counts', async () => {
    const r = await app.client().get('/api/genres');
    assert.ok(r.json.genres.length > 5);
    assert.ok(r.json.genres.every((g) => g.count > 0));
  });

  test('home: hero, rows, empty continue-watching for anonymous', async () => {
    const r = await app.client().get('/api/home');
    assert.ok(r.json.hero.length >= 1);
    const keys = r.json.rows.map((x) => x.key);
    for (const k of ['trending', 'new', 'movies', 'series', 'anime']) assert.ok(keys.includes(k), k);
    assert.deepEqual(r.json.continueWatching, []);
  });

  test('FR-13: playback start counts a view and feeds "popular" sort', async () => {
    const c = app.client();
    const t = (await c.get('/api/titles/elephants-dream')).json; // free → anonymous playback allowed
    const before = app.db.prepare('SELECT views FROM titles WHERE id = ?').get(t.id).views;
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/playback', { titleId: t.id })).status, 200);
    assert.equal(app.db.prepare('SELECT views FROM titles WHERE id = ?').get(t.id).views, before + 3);
    // push far ahead so ordering is deterministic regardless of seed view counts
    app.db.prepare('UPDATE titles SET views = views + 1000 WHERE id = ?').run(t.id);
    const r = await c.get('/api/titles?sort=popular&limit=1');
    assert.equal(r.json.items[0].slug, 'elephants-dream');
    assert.equal((await c.post('/api/playback', { titleId: 999999 })).status, 404);
  });
});

describe('FR-09 watchlist', () => {
  test('requires authentication', async () => {
    assert.equal((await app.client().get('/api/watchlist')).status, 401);
    assert.equal((await app.client().put('/api/watchlist/1')).status, 401);
  });

  test('add (idempotent), list, flag in details, remove', async () => {
    const c = app.client();
    await registerUser(c);
    const t = (await c.get('/api/titles/sintel')).json;
    assert.equal(t.inWatchlist, false);
    assert.equal((await c.put(`/api/watchlist/${t.id}`)).status, 200);
    assert.equal((await c.put(`/api/watchlist/${t.id}`)).status, 200);
    const list = (await c.get('/api/watchlist')).json.items;
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'sintel');
    assert.equal((await c.get('/api/titles/sintel')).json.inWatchlist, true);
    assert.equal((await c.del(`/api/watchlist/${t.id}`)).status, 200);
    assert.equal((await c.get('/api/watchlist')).json.items.length, 0);
  });

  test('unknown title → 404; lists are per-user', async () => {
    const a = app.client();
    const b = app.client();
    await registerUser(a);
    await registerUser(b);
    assert.equal((await a.put('/api/watchlist/999999')).status, 404);
    const id = (await a.get('/api/titles/sintel')).json.id;
    await a.put(`/api/watchlist/${id}`);
    assert.equal((await b.get('/api/watchlist')).json.items.length, 0);
  });
});

describe('FR-10 ratings', () => {
  test('validation, update and aggregation', async () => {
    const a = app.client();
    const b = app.client();
    await registerUser(a);
    await registerUser(b);
    const id = (await a.get('/api/titles/elephants-dream')).json.id;

    assert.equal((await a.put(`/api/titles/${id}/rating`, { stars: 0 })).status, 400);
    assert.equal((await a.put(`/api/titles/${id}/rating`, { stars: 6 })).status, 400);
    assert.equal((await a.put(`/api/titles/${id}/rating`, { stars: 2.5 })).status, 400);
    assert.equal((await app.client().put(`/api/titles/${id}/rating`, { stars: 5 })).status, 401);

    let r = await a.put(`/api/titles/${id}/rating`, { stars: 4 });
    assert.equal(r.json.avgRating, 4);
    r = await a.put(`/api/titles/${id}/rating`, { stars: 2 });
    assert.equal(r.json.ratingCount, 1);
    assert.equal(r.json.avgRating, 2);
    r = await b.put(`/api/titles/${id}/rating`, { stars: 5 });
    assert.equal(r.json.ratingCount, 2);
    assert.equal(r.json.avgRating, 3.5);

    const d = (await a.get('/api/titles/elephants-dream')).json;
    assert.equal(d.myRating, 2);
    assert.equal(d.avgRating, 3.5);
  });
});

describe('FR-08/11 progress and continue watching', () => {
  test('requires authentication', async () => {
    assert.equal((await app.client().put('/api/progress', { titleId: 1, position: 10, duration: 100 })).status, 401);
  });

  test('movie progress appears in continue watching and in details', async () => {
    const c = app.client();
    await registerUser(c);
    const id = (await c.get('/api/titles/big-buck-bunny')).json.id;
    assert.equal((await c.put('/api/progress', { titleId: id, position: 120, duration: 600 })).status, 200);
    const cw = (await c.get('/api/progress')).json.items;
    assert.equal(cw.length, 1);
    assert.equal(cw[0].slug, 'big-buck-bunny');
    assert.equal(cw[0].position, 120);
    assert.equal(cw[0].percent, 0.2);
    assert.equal((await c.get('/api/home')).json.continueWatching.length, 1);
    const d = (await c.get('/api/titles/big-buck-bunny')).json;
    assert.deepEqual(d.progress, [{ episodeId: 0, position: 120, duration: 600 }]);
  });

  test('finished movie and tiny positions are not listed', async () => {
    const c = app.client();
    await registerUser(c);
    const a = (await c.get('/api/titles/sintel')).json.id;
    const b = (await c.get('/api/titles/tears-of-steel')).json.id;
    await c.put('/api/progress', { titleId: a, position: 590, duration: 600 });
    await c.put('/api/progress', { titleId: b, position: 2, duration: 600 });
    assert.equal((await c.get('/api/progress')).json.items.length, 0);
  });

  test('series: episodeId is required and must belong to the title', async () => {
    const c = app.client();
    await registerUser(c);
    const t = (await c.get('/api/titles/orbit-station')).json;
    const other = (await c.get('/api/titles/harbor-lights')).json.episodes[0].id;
    assert.equal((await c.put('/api/progress', { titleId: t.id, position: 50, duration: 600 })).status, 400);
    assert.equal((await c.put('/api/progress', { titleId: t.id, episodeId: other, position: 50, duration: 600 })).status, 404);
    const mv = (await c.get('/api/titles/sintel')).json.id;
    assert.equal((await c.put('/api/progress', { titleId: mv, episodeId: other, position: 50, duration: 600 })).status, 400);
  });

  test('finishing an episode surfaces the next one; finishing the last drops the series', async () => {
    const c = app.client();
    await registerUser(c);
    const t = (await c.get('/api/titles/orbit-station')).json;
    const [e1, e2, , e4] = t.episodes;

    await c.put('/api/progress', { titleId: t.id, episodeId: e1.id, position: 590, duration: 600 });
    let cw = (await c.get('/api/progress')).json.items;
    assert.equal(cw.length, 1);
    assert.equal(cw[0].episode.id, e2.id);
    assert.equal(cw[0].position, 0);

    await c.put('/api/progress', { titleId: t.id, episodeId: e4.id, position: 300, duration: 600 });
    cw = (await c.get('/api/progress')).json.items;
    assert.equal(cw[0].episode.id, e4.id);
    assert.equal(cw[0].position, 300);

    await c.put('/api/progress', { titleId: t.id, episodeId: e4.id, position: 599, duration: 600 });
    cw = (await c.get('/api/progress')).json.items;
    assert.equal(cw.length, 0);
  });

  test('position is clamped to duration; negatives rejected', async () => {
    const c = app.client();
    await registerUser(c);
    const id = (await c.get('/api/titles/elephants-dream')).json.id;
    assert.equal((await c.put('/api/progress', { titleId: id, position: -1, duration: 100 })).status, 400);
    await c.put('/api/progress', { titleId: id, position: 900, duration: 100 });
    const rows = (await c.get(`/api/progress/${id}`)).json.items;
    assert.equal(rows[0].position, 100);
  });
});

describe('FR-12 admin', () => {
  const sample = {
    type: 'series', name: 'Test Series', synopsis: 'x', year: 2026, ageRating: '12+',
    genres: ['Drama', 'drama', 'Noir'], status: 'draft',
  };

  test('authorisation: anon 401, user 403, admin 200', async () => {
    assert.equal((await app.client().get('/api/admin/titles')).status, 401);
    const u = app.client();
    await registerUser(u);
    assert.equal((await u.get('/api/admin/titles')).status, 403);
    assert.equal((await u.post('/api/admin/titles', sample)).status, 403);
    const a = app.client();
    await loginAdmin(a);
    assert.equal((await a.get('/api/admin/titles')).status, 200);
  });

  test('draft lifecycle: hidden → add episodes → publish → visible → delete cascades', async () => {
    const a = app.client();
    await loginAdmin(a);
    const created = await a.post('/api/admin/titles', sample);
    assert.equal(created.status, 201);
    const t = created.json.title;
    assert.deepEqual(t.genres, ['Drama', 'Noir']);
    assert.equal(t.status, 'draft');

    const pub = app.client();
    assert.equal((await pub.get(`/api/titles/${t.slug}`)).status, 404);
    assert.equal((await pub.get('/api/titles?q=Test%20Series')).json.total, 0);
    assert.equal((await a.get(`/api/titles/${t.slug}`)).status, 200);

    const ep = { season: 1, number: 1, name: 'Pilot', videoUrl: 'https://example.com/a.m3u8' };
    const e1 = await a.post(`/api/admin/titles/${t.id}/episodes`, ep);
    assert.equal(e1.status, 201);
    assert.equal((await a.post(`/api/admin/titles/${t.id}/episodes`, ep)).status, 409);
    assert.equal((await a.post(`/api/admin/titles/${t.id}/episodes`, { ...ep, number: 2, videoUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await a.post(`/api/admin/titles/${t.id}/episodes`, { ...ep, number: 3, videoUrl: 'ftp://x/y' })).status, 400);

    const up = await a.put(`/api/admin/titles/${t.id}`, { status: 'published', featured: true, synopsis: 'updated' });
    assert.equal(up.json.title.status, 'published');
    assert.equal(up.json.title.synopsis, 'updated');
    const detail = await pub.get(`/api/titles/${t.slug}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.episodes.length, 1);

    assert.equal((await a.del(`/api/admin/episodes/${e1.json.id}`)).status, 200);
    assert.equal((await a.del(`/api/admin/titles/${t.id}`)).status, 200);
    assert.equal((await pub.get(`/api/titles/${t.slug}`)).status, 404);
    assert.equal(app.db.prepare('SELECT COUNT(*) c FROM episodes WHERE title_id = ?').get(t.id).c, 0);
    assert.equal((await a.del(`/api/admin/titles/${t.id}`)).status, 404);
  });

  test('validation: movie needs videoUrl to be published; bad type/name', async () => {
    const a = app.client();
    await loginAdmin(a);
    assert.equal((await a.post('/api/admin/titles', { type: 'movie', name: 'No Video' })).status, 400);
    assert.equal((await a.post('/api/admin/titles', { type: 'podcast', name: 'X' })).status, 400);
    assert.equal((await a.post('/api/admin/titles', { type: 'movie' })).status, 400);
    const ok = await a.post('/api/admin/titles', { type: 'movie', name: 'With Video', videoUrl: 'https://example.com/v.mp4' });
    assert.equal(ok.status, 201);
    assert.equal((await a.post(`/api/admin/titles/${ok.json.title.id}/episodes`, { number: 1, name: 'x', videoUrl: 'https://e.co/x.mp4' })).status, 400);
  });

  test('slugs stay unique for same-name titles', async () => {
    const a = app.client();
    await loginAdmin(a);
    const body = { type: 'movie', name: 'Twin', videoUrl: 'https://example.com/v.mp4' };
    const t1 = (await a.post('/api/admin/titles', body)).json.title;
    const t2 = (await a.post('/api/admin/titles', body)).json.title;
    assert.notEqual(t1.slug, t2.slug);
  });

  test('draft titles cannot be watchlisted, rated or counted', async () => {
    const a = app.client();
    await loginAdmin(a);
    const t = (await a.post('/api/admin/titles', sample)).json.title;
    const u = app.client();
    await registerUser(u);
    assert.equal((await u.put(`/api/watchlist/${t.id}`)).status, 404);
    assert.equal((await u.put(`/api/titles/${t.id}/rating`, { stars: 3 })).status, 404);
    assert.equal((await u.post('/api/playback', { titleId: t.id, clientId: 'client-draft-xxxxxxxx' })).status, 404);
  });

  test('role changes in the DB take effect immediately', async () => {
    const c = app.client();
    const u = await registerUser(c);
    assert.equal((await c.get('/api/admin/titles')).status, 403);
    app.db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(u.email);
    assert.equal((await c.get('/api/admin/titles')).status, 200);
    app.db.prepare("UPDATE users SET role = 'user' WHERE email = ?").run(u.email);
    assert.equal((await c.get('/api/admin/titles')).status, 403);
  });
});

describe('NFR-02 rate limiting', () => {
  test('auth endpoints return 429 after 20 attempts', async () => {
    const limited = await boot({ rateLimit: true });
    try {
      const c = limited.client();
      let last = 0;
      for (let i = 0; i < 22; i++) {
        last = (await c.post('/api/auth/login', { email: 'x@y.co', password: 'wrongwrong' })).status;
      }
      assert.equal(last, 429);
    } finally {
      await limited.close();
    }
  });
});

describe('static client', () => {
  test('serves index.html and the vendored hls.js', async () => {
    const c = app.client();
    const home = await c.get('/');
    assert.equal(home.status, 200);
    assert.match(home.text, /MovieOn/);
    const hls = await c.get('/vendor/hls.min.js');
    assert.equal(hls.status, 200);
    assert.match(hls.headers.get('content-type'), /javascript/);
  });
});
