import { Router } from 'express';
import { HttpError, int, oneOf, str } from '../util.js';
import { TIERS } from '../plans.js';
import { canWatch, userLevel } from '../entitlements.js';
import {
  SORT_KEYS, getEpisodes, getTitleBySlug, listTitles, serializeTitles,
} from '../catalog.js';
import { continueWatching } from '../progress.js';

const TYPES = ['movie', 'series', 'anime'];

export function titleRoutes(db) {
  const r = Router();

  r.get('/genres', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT g.name, COUNT(t.id) AS count FROM genres g
         JOIN title_genres tg ON tg.genre_id = g.id
         JOIN titles t ON t.id = tg.title_id AND t.status = 'published'
         GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
      )
      .all();
    res.json({ genres: rows });
  });

  r.get('/home', (req, res) => {
    const page = (opts) => listTitles(db, { limit: 12, ...opts }).items;
    const heroRows = db
      .prepare(
        `SELECT t.*, NULL AS avg_rating, 0 AS rating_count FROM titles t
         WHERE t.status = 'published' AND t.featured = 1 ORDER BY t.id DESC LIMIT 5`,
      )
      .all();
    const rows = [
      { key: 'free', title: 'Free to watch', tier: 'free', items: page({ tier: 'free', sort: 'popular' }) },
      { key: 'trending', title: 'Trending now', items: page({ sort: 'popular' }) },
      { key: 'new', title: 'New releases', items: page({ sort: 'newest' }) },
      { key: 'movies', title: 'Movies', type: 'movie', items: page({ type: 'movie' }) },
      { key: 'series', title: 'Series', type: 'series', items: page({ type: 'series' }) },
      { key: 'anime', title: 'Anime', type: 'anime', items: page({ type: 'anime' }) },
    ].filter((row) => row.items.length > 0);
    res.json({
      hero: serializeTitles(db, heroRows),
      rows,
      continueWatching: req.user ? continueWatching(db, req.user.id) : [],
    });
  });

  r.get('/titles', (req, res) => {
    const q = str(req.query.q, 'q', { max: 100 });
    const type = oneOf(req.query.type || null, 'type', TYPES);
    const tier = oneOf(req.query.tier || null, 'tier', TIERS);
    const sort = oneOf(req.query.sort || null, 'sort', SORT_KEYS) ?? 'newest';
    const genre = str(req.query.genre, 'genre', { max: 40 }) || null;
    const page = int(req.query.page, 'page', { min: 1, max: 10000 }) ?? 1;
    const limit = int(req.query.limit, 'limit', { min: 1, max: 50 }) ?? 24;
    res.json(listTitles(db, { type, genre, tier, q: q || null, sort, page, limit }));
  });

  r.get('/titles/:slug', (req, res) => {
    const row = getTitleBySlug(db, req.params.slug);
    if (!row || (row.status !== 'published' && req.user?.role !== 'admin')) {
      throw new HttpError(404, 'Title not found');
    }
    const [title] = serializeTitles(db, [row]);
    // Video URLs are never part of this payload: they are issued by POST /api/playback after the
    // tier / screen-limit checks.
    const episodes = getEpisodes(db, row.id).map(({ videoUrl, ...ep }) => ep);
    const out = {
      ...title,
      hasSource: row.type === 'movie' ? !!row.video_url : episodes.length > 0,
      canWatch: canWatch(userLevel(db, req.user), row.min_tier),
      episodes,
      myRating: null,
      inWatchlist: false,
      progress: [],
    };
    if (req.user) {
      out.myRating = db
        .prepare('SELECT stars FROM ratings WHERE user_id = ? AND title_id = ?')
        .get(req.user.id, row.id)?.stars ?? null;
      out.inWatchlist = !!db
        .prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND title_id = ?')
        .get(req.user.id, row.id);
      out.progress = db
        .prepare(
          `SELECT episode_id AS episodeId, position_sec AS position, duration_sec AS duration
           FROM progress WHERE user_id = ? AND title_id = ?`,
        )
        .all(req.user.id, row.id);
    }
    res.json(out);
  });

  return r;
}
