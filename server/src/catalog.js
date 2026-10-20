/** Catalog queries and serialisation shared by routes. */

const BASE_SELECT = `
  SELECT t.*,
    (SELECT ROUND(AVG(stars), 2) FROM ratings r WHERE r.title_id = t.id) AS avg_rating,
    (SELECT COUNT(*) FROM ratings r WHERE r.title_id = t.id) AS rating_count
  FROM titles t`;

const SORTS = {
  newest: 't.created_at DESC, t.id DESC',
  name: 't.name COLLATE NOCASE ASC',
  rating: 'avg_rating IS NULL, avg_rating DESC, t.views DESC',
  popular: 't.views DESC, t.id DESC',
};

export const SORT_KEYS = Object.keys(SORTS);

export function genresFor(db, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT tg.title_id, g.name FROM title_genres tg JOIN genres g ON g.id = tg.genre_id
       WHERE tg.title_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.name COLLATE NOCASE`,
    )
    .all(...ids);
  for (const r of rows) map.get(r.title_id).push(r.name);
  return map;
}

/** Card-level representation (no video URLs). */
export function serializeTitles(db, rows) {
  const genres = genresFor(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    type: r.type,
    name: r.name,
    synopsis: r.synopsis,
    year: r.year,
    ageRating: r.age_rating,
    durationMin: r.duration_min,
    hue1: r.hue1,
    hue2: r.hue2,
    featured: !!r.featured,
    status: r.status,
    minTier: r.min_tier,
    views: r.views,
    avgRating: r.avg_rating,
    ratingCount: r.rating_count,
    genres: genres.get(r.id) ?? [],
  }));
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listTitles(db, { type, genre, tier, q, sort = 'newest', page = 1, limit = 24, includeDrafts = false }) {
  const where = [];
  const params = [];
  if (!includeDrafts) where.push("t.status = 'published'");
  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  if (tier) {
    where.push('t.min_tier = ?');
    params.push(tier);
  }
  if (genre) {
    where.push(`EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id = tg.genre_id
                        WHERE tg.title_id = t.id AND g.name = ? COLLATE NOCASE)`);
    params.push(genre);
  }
  if (q) {
    where.push("(t.name LIKE ? ESCAPE '\\' OR t.synopsis LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM titles t ${whereSql}`).get(...params).c;
  const rows = db
    .prepare(`${BASE_SELECT} ${whereSql} ORDER BY ${SORTS[sort] ?? SORTS.newest} LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return {
    items: serializeTitles(db, rows),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function getTitleBySlug(db, slug) {
  return db.prepare(`${BASE_SELECT} WHERE t.slug = ?`).get(slug);
}

export function getTitleById(db, id) {
  return db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id);
}

export function getEpisodes(db, titleId) {
  return db
    .prepare(
      `SELECT id, season, number, name, synopsis, duration_min AS durationMin, video_url AS videoUrl
       FROM episodes WHERE title_id = ? ORDER BY season, number`,
    )
    .all(titleId);
}

export function setGenres(db, titleId, names) {
  const insGenre = db.prepare('INSERT OR IGNORE INTO genres (name) VALUES (?)');
  const getGenre = db.prepare('SELECT id FROM genres WHERE name = ? COLLATE NOCASE');
  db.prepare('DELETE FROM title_genres WHERE title_id = ?').run(titleId);
  const link = db.prepare('INSERT OR IGNORE INTO title_genres (title_id, genre_id) VALUES (?, ?)');
  for (const name of names) {
    insGenre.run(name);
    link.run(titleId, getGenre.get(name).id);
  }
}
