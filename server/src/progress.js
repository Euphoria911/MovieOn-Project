/** Continue-watching logic. */

export const FINISHED_RATIO = 0.95;
const MIN_SECONDS = 5;

export function continueWatching(db, userId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT p.title_id, p.episode_id, p.position_sec, p.duration_sec, p.updated_at,
              t.slug, t.type, t.name, t.hue1, t.hue2, t.age_rating, t.year,
              e.season AS ep_season, e.number AS ep_number, e.name AS ep_name
       FROM progress p
       JOIN titles t ON t.id = p.title_id AND t.status = 'published'
       LEFT JOIN episodes e ON e.id = p.episode_id
       WHERE p.user_id = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(userId);

  const nextEp = db.prepare(
    `SELECT id, season, number, name FROM episodes
     WHERE title_id = ? AND (season > ? OR (season = ? AND number > ?))
     ORDER BY season, number LIMIT 1`,
  );

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.title_id)) continue; // newest row per title wins
    seen.add(r.title_id);

    const finished = r.duration_sec > 0 && r.position_sec / r.duration_sec >= FINISHED_RATIO;
    let episode = r.episode_id
      ? { id: r.episode_id, season: r.ep_season, number: r.ep_number, name: r.ep_name }
      : null;
    let position = r.position_sec;
    let percent = r.duration_sec > 0 ? r.position_sec / r.duration_sec : 0;

    if (finished) {
      if (r.type === 'movie' || !episode) continue;
      const next = nextEp.get(r.title_id, episode.season, episode.season, episode.number);
      if (!next) continue; // series finished
      episode = next;
      position = 0;
      percent = 0;
    } else if (r.position_sec < MIN_SECONDS) {
      continue;
    }

    out.push({
      titleId: r.title_id,
      slug: r.slug,
      type: r.type,
      name: r.name,
      hue1: r.hue1,
      hue2: r.hue2,
      ageRating: r.age_rating,
      year: r.year,
      episode,
      position,
      percent: Math.min(1, percent),
    });
    if (out.length >= limit) break;
  }
  return out;
}
