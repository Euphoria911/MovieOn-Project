import { Router } from 'express';
import { HttpError, bad, email as vEmail, int, oneOf, slugify, str } from '../util.js';
import { getTitleById, listTitles, serializeTitles, setGenres } from '../catalog.js';
import { PERIOD_DAYS, PLANS, TIERS } from '../plans.js';
import { normalizeSource, requireRightsNote, sourceKind } from '../sources.js';

const TYPES = ['movie', 'series', 'anime'];
const STATUSES = ['published', 'draft'];
const AGE = ['0+', '6+', '12+', '16+', '18+'];
const DAY = 86_400_000;

function hueFromName(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = h % 360;
  return [h1, (h1 + 60 + (h % 120)) % 360];
}

function parseGenres(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw bad('genres must be an array of strings');
  if (value.length > 8) throw bad('at most 8 genres');
  const names = value.map((g) => str(g, 'genre', { required: true, max: 30 }));
  return [...new Set(names.map((n) => n.toLowerCase()))].map(
    (lower) => names.find((n) => n.toLowerCase() === lower),
  );
}

export function adminRoutes(db, auth) {
  const r = Router();
  r.use(auth.requireAdmin);

  const uniqueSlug = (name) => {
    const base = slugify(name);
    let slug = base;
    let i = 2;
    while (db.prepare('SELECT 1 FROM titles WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
    return slug;
  };

  r.get('/titles', (req, res) => {
    const page = int(req.query.page, 'page', { min: 1 }) ?? 1;
    const out = listTitles(db, { sort: 'newest', page, limit: 50, includeDrafts: true });
    // Admin-only fields not present in the public payload.
    const extra = new Map(
      db.prepare('SELECT id, video_url, rights_note FROM titles').all().map((r2) => [r2.id, r2]),
    );
    out.items = out.items.map((t) => {
      const e = extra.get(t.id);
      return { ...t, videoUrl: e?.video_url ?? null, rightsNote: e?.rights_note ?? '', sourceKind: sourceKind(e?.video_url) };
    });
    res.json(out);
  });

  r.post('/titles', (req, res) => {
    const b = req.body ?? {};
    const type = oneOf(b.type, 'type', TYPES, { required: true });
    const name = str(b.name, 'name', { required: true, max: 120 });
    const status = oneOf(b.status, 'status', STATUSES) ?? 'published';
    const minTier = oneOf(b.minTier, 'minTier', TIERS) ?? 'free';
    const rightsNote = str(b.rightsNote, 'rightsNote', { max: 500 });
    const source = type === 'movie' ? normalizeSource(b.videoUrl, 'videoUrl') : null;
    if (type === 'movie' && status === 'published' && !source) {
      throw bad('videoUrl is required for a published movie');
    }
    requireRightsNote(source?.kind, rightsNote);
    const [h1, h2] = hueFromName(name);
    const genres = parseGenres(b.genres) ?? [];

    db.exec('BEGIN');
    try {
      const info = db
        .prepare(
          `INSERT INTO titles (slug, type, name, synopsis, year, age_rating, duration_min, video_url,
                               hue1, hue2, featured, status, min_tier, rights_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uniqueSlug(name), type, name, str(b.synopsis, 'synopsis', { max: 2000 }),
          int(b.year, 'year', { min: 1888, max: 2100 }),
          oneOf(b.ageRating, 'ageRating', AGE) ?? '12+',
          int(b.durationMin, 'durationMin', { min: 1, max: 1000 }),
          source?.url ?? null,
          int(b.hue1, 'hue1', { min: 0, max: 360 }) ?? h1,
          int(b.hue2, 'hue2', { min: 0, max: 360 }) ?? h2,
          b.featured ? 1 : 0,
          status, minTier, rightsNote,
        );
      const id = Number(info.lastInsertRowid);
      setGenres(db, id, genres);
      db.exec('COMMIT');
      const [item] = serializeTitles(db, [getTitleById(db, id)]);
      res.status(201).json({ title: item });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  r.put('/titles/:id', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    const cur = getTitleById(db, id);
    if (!cur) throw new HttpError(404, 'Title not found');
    const b = req.body ?? {};
    const has = (k) => b[k] !== undefined;

    const name = has('name') ? str(b.name, 'name', { required: true, max: 120 }) : cur.name;
    const status = has('status') ? oneOf(b.status, 'status', STATUSES, { required: true }) : cur.status;
    const minTier = has('minTier') ? oneOf(b.minTier, 'minTier', TIERS, { required: true }) : cur.min_tier;
    const rightsNote = has('rightsNote') ? str(b.rightsNote, 'rightsNote', { max: 500 }) : cur.rights_note;
    const source = cur.type === 'movie'
      ? (has('videoUrl') ? normalizeSource(b.videoUrl, 'videoUrl') : (cur.video_url ? { url: cur.video_url, kind: sourceKind(cur.video_url) } : null))
      : null;
    if (cur.type === 'movie' && status === 'published' && !source) {
      throw bad('videoUrl is required for a published movie');
    }
    requireRightsNote(source?.kind, rightsNote);
    const genres = parseGenres(b.genres);

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE titles SET name = ?, synopsis = ?, year = ?, age_rating = ?, duration_min = ?, video_url = ?,
                           hue1 = ?, hue2 = ?, featured = ?, status = ?, min_tier = ?, rights_note = ? WHERE id = ?`,
      ).run(
        name,
        has('synopsis') ? str(b.synopsis, 'synopsis', { max: 2000 }) : cur.synopsis,
        has('year') ? int(b.year, 'year', { min: 1888, max: 2100 }) : cur.year,
        has('ageRating') ? oneOf(b.ageRating, 'ageRating', AGE, { required: true }) : cur.age_rating,
        has('durationMin') ? int(b.durationMin, 'durationMin', { min: 1, max: 1000 }) : cur.duration_min,
        source?.url ?? null,
        has('hue1') ? int(b.hue1, 'hue1', { min: 0, max: 360, required: true }) : cur.hue1,
        has('hue2') ? int(b.hue2, 'hue2', { min: 0, max: 360, required: true }) : cur.hue2,
        has('featured') ? (b.featured ? 1 : 0) : cur.featured,
        status, minTier, rightsNote, id,
      );
      if (genres) setGenres(db, id, genres);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const [item] = serializeTitles(db, [getTitleById(db, id)]);
    res.json({ title: item });
  });

  r.delete('/titles/:id', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    const info = db.prepare('DELETE FROM titles WHERE id = ?').run(id);
    if (info.changes === 0) throw new HttpError(404, 'Title not found');
    res.json({ ok: true });
  });

  r.get('/titles/:id/episodes', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    if (!getTitleById(db, id)) throw new HttpError(404, 'Title not found');
    const rows = db
      .prepare(
        `SELECT id, season, number, name, synopsis, duration_min AS durationMin, video_url AS videoUrl
         FROM episodes WHERE title_id = ? ORDER BY season, number`,
      )
      .all(id);
    res.json({ items: rows.map((e) => ({ ...e, sourceKind: sourceKind(e.videoUrl) })) });
  });

  r.post('/titles/:id/episodes', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    const title = getTitleById(db, id);
    if (!title) throw new HttpError(404, 'Title not found');
    if (title.type === 'movie') throw bad('movies cannot have episodes');
    const b = req.body ?? {};
    const source = normalizeSource(b.videoUrl, 'videoUrl', { required: true });
    requireRightsNote(source.kind, title.rights_note, 'title');
    try {
      const info = db
        .prepare(
          `INSERT INTO episodes (title_id, season, number, name, synopsis, duration_min, video_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          int(b.season, 'season', { min: 1, max: 100 }) ?? 1,
          int(b.number, 'number', { min: 1, max: 10000, required: true }),
          str(b.name, 'name', { required: true, max: 120 }),
          str(b.synopsis, 'synopsis', { max: 2000 }),
          int(b.durationMin, 'durationMin', { min: 1, max: 1000 }),
          source.url,
        );
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(409, 'An episode with this season and number already exists');
      }
      throw e;
    }
  });

  r.delete('/episodes/:id', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    const info = db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
    if (info.changes === 0) throw new HttpError(404, 'Episode not found');
    res.json({ ok: true });
  });

  // ---- manual subscriptions (support, comps, and the only way to grant plans without a payment provider) ----
  r.post('/subscriptions', (req, res) => {
    const email = vEmail(req.body?.email);
    const plan = oneOf(req.body?.plan, 'plan', PLANS.map((p) => p.id), { required: true });
    const days = int(req.body?.days ?? PERIOD_DAYS, 'days', { min: 1, max: 366 });
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) throw new HttpError(404, 'No user with that email');
    const now = Date.now();
    db.prepare(
      `INSERT INTO subscriptions (user_id, plan, status, started_at, current_period_end, provider, provider_ref)
       VALUES (?, ?, 'active', ?, ?, 'admin', ?)
       ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active',
         started_at = excluded.started_at, current_period_end = excluded.current_period_end,
         provider = 'admin', provider_ref = excluded.provider_ref`,
    ).run(user.id, plan, new Date(now).toISOString(), new Date(now + days * DAY).toISOString(), `by_admin_${req.user.id}`);
    res.status(201).json({ ok: true, plan, days });
  });

  r.post('/subscriptions/revoke', (req, res) => {
    const email = vEmail(req.body?.email);
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) throw new HttpError(404, 'No user with that email');
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM playback_sessions WHERE user_id = ?').run(user.id);
    res.json({ ok: true });
  });

  return r;
}
