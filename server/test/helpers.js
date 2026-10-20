import { openDb } from '../src/db.js';
import { seedCatalog, ensureAdmin } from '../src/seed.js';
import { createApp } from '../src/app.js';

export const ADMIN = { email: 'admin@test.local', password: 'adminpass1' };

export async function boot(opts = {}) {
  const db = openDb(':memory:');
  seedCatalog(db);
  ensureAdmin(db, ADMIN);
  const app = createApp(db, { secret: 'test-secret', rateLimit: false, production: false, billingProvider: 'mock', ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    client: () => client(base),
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

/** Tiny fetch wrapper with a cookie jar. */
export function client(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      cookie = pair.slice(idx + 1) === '' ? '' : pair;
    }
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    call,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b ?? {}, h),
    put: (p, b, h) => call('PUT', p, b ?? {}, h),
    del: (p, h) => call('DELETE', p, undefined, h),
    get cookie() { return cookie; },
  };
}

let n = 0;
export async function registerUser(c, over = {}) {
  n += 1;
  const body = { email: `user${n}@test.local`, username: `User ${n}`, password: 'password123', ...over };
  const r = await c.post('/api/auth/register', body);
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.text}`);
  return body;
}

export async function loginAdmin(c) {
  const r = await c.post('/api/auth/login', ADMIN);
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status}`);
}

export function grant(db, email, plan, days = 30) {
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  const now = Date.now();
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, current_period_end, provider)
     VALUES (?, ?, 'active', ?, ?, 'test')
     ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active',
       started_at = excluded.started_at, current_period_end = excluded.current_period_end`,
  ).run(u.id, plan, new Date(now).toISOString(), new Date(now + days * 86_400_000).toISOString());
}

let cid = 0;
export const newClientId = () => `client-${Date.now()}-${++cid}-xxxxxxxx`;
