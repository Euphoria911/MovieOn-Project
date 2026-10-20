import { Router } from 'express';
import { HttpError, bad, int, num } from '../util.js';
import { getTitleById, serializeTitles } from '../catalog.js';
import { continueWatching } from '../progress.js';

/** Watchlist, ratings and playback progress — all require a signed-in user. */
export function meRoutes(db, auth) {
  const r = Router();
  // Scoped (not a blanket r.use) so unknown /api paths still fall through to a 404.
  r.use(['/watchlist', '/progress', '/titles/:id/rating'], auth.requireAuth);

  const publishedTitle = (id) => {
    const t = getTitleById(db, id);
    if (!t || t.status !== 'published') throw new HttpError(404, 'Title not found');
    return t;
  };

  // ---- watchlist ----
  r.get('/watchlist', (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*,
           (SELECT ROUND(AVG(stars), 2) FROM ratings x WHERE x.title_id = t.id) AS avg_rating,
           (SELECT COUNT(*) FROM ratings x WHERE x.title_id = t.id) AS rating_count
         FROM watchlist w JOIN titles t ON t.id = w.title_id
         WHERE w.user_id = ? AND t.status = 'published'
         ORDER BY w.added_at DESC, t.id DESC`,
      )
      .all(req.user.id);
    res.json({ items: serializeTitles(db, rows) });
  });

  r.put('/watchlist/:titleId', (req, res) => {
    const id = int(req.params.titleId, 'titleId', { min: 1, required: true });
    publishedTitle(id);
    db.prepare('INSERT OR IGNORE INTO watchlist (user_id, title_id) VALUES (?, ?)').run(req.user.id, id);
    res.json({ inWatchlist: true });
  });

  r.delete('/watchlist/:titleId', (req, res) => {
    const id = int(req.params.titleId, 'titleId', { min: 1, required: true });
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?').run(req.user.id, id);
    res.json({ inWatchlist: false });
  });

  // ---- ratings ----
  r.put('/titles/:id/rating', (req, res) => {
    const id = int(req.params.id, 'id', { min: 1, required: true });
    const stars = int(req.body?.stars, 'stars', { min: 1, max: 5, required: true });
    publishedTitle(id);
    db.prepare(
      `INSERT INTO ratings (user_id, title_id, stars) VALUES (?, ?, ?)
       ON CONFLICT(user_id, title_id) DO UPDATE SET stars = excluded.stars`,
    ).run(req.user.id, id, stars);
    const agg = db
      .prepare('SELECT ROUND(AVG(stars), 2) AS avg, COUNT(*) AS n FROM ratings WHERE title_id = ?')
      .get(id);
    res.json({ myRating: stars, avgRating: agg.avg, ratingCount: agg.n });
  });

  // ---- progress ----
  r.get('/progress', (req, res) => {
    res.json({ items: continueWatching(db, req.user.id) });
  });

  r.get('/progress/:titleId', (req, res) => {
    const id = int(req.params.titleId, 'titleId', { min: 1, required: true });
    const rows = db
      .prepare(
        `SELECT episode_id AS episodeId, position_sec AS position, duration_sec AS duration
         FROM progress WHERE user_id = ? AND title_id = ?`,
      )
      .all(req.user.id, id);
    res.json({ items: rows });
  });

  r.put('/progress', (req, res) => {
    const titleId = int(req.body?.titleId, 'titleId', { min: 1, required: true });
    const episodeId = int(req.body?.episodeId, 'episodeId', { min: 1 });
    const duration = num(req.body?.duration ?? 0, 'duration', { min: 0, max: 86400 });
    let position = num(req.body?.position, 'position', { min: 0, max: 86400 });
    if (duration > 0 && position > duration) position = duration;

    const title = publishedTitle(titleId);
    let epRowId = 0;
    if (title.type === 'movie') {
      if (episodeId) throw bad('movies have no episodes');
    } else {
      if (!episodeId) throw bad('episodeId is required for series and anime');
      const ep = db.prepare('SELECT id FROM episodes WHERE id = ? AND title_id = ?').get(episodeId, titleId);
      if (!ep) throw new HttpError(404, 'Episode not found');
      epRowId = episodeId;
    }

    db.prepare(
      `INSERT INTO progress (user_id, title_id, episode_id, position_sec, duration_sec, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
       ON CONFLICT(user_id, title_id, episode_id) DO UPDATE SET
         position_sec = excluded.position_sec,
         duration_sec = excluded.duration_sec,
         updated_at = excluded.updated_at`,
    ).run(req.user.id, titleId, epRowId, position, duration);
    res.json({ ok: true });
  });

  return r;
}
