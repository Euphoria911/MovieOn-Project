import { Router } from 'express';
import crypto from 'node:crypto';
import { HttpError, bad, int, str } from '../util.js';
import { getTitleById } from '../catalog.js';
import { screensForLevel } from '../plans.js';
import { canWatch, userLevel } from '../entitlements.js';
import { sourceKind } from '../sources.js';

export const SESSION_TTL_MS = 90_000;
export const HEARTBEAT_SEC = 30;

/**
 * Playback authorisation. The video URL is only revealed here, after the tier check and the
 * simultaneous-screens check — it is NOT part of the public title payload.
 *
 * Honest limit: once a URL has been handed to a client it can be copied. Real protection of the
 * media files needs signed, expiring CDN URLs and/or DRM (roadmap v2.0).
 */
export function playbackRoutes(db) {
  const r = Router();

  const purge = (now) => db.prepare('DELETE FROM playback_sessions WHERE last_seen < ?').run(now - SESSION_TTL_MS);

  function upgradeError(user, title) {
    return user
      ? new HttpError(403, `This title requires a ${title.min_tier} plan or higher.`, {
        code: 'upgrade_required', requiredTier: title.min_tier,
      })
      : new HttpError(401, 'Sign in to watch this title.', { code: 'login_required', requiredTier: title.min_tier });
  }

  r.post('/playback', (req, res) => {
    const titleId = int(req.body?.titleId, 'titleId', { min: 1, required: true });
    const episodeId = int(req.body?.episodeId, 'episodeId', { min: 1 });
    const clientId = str(req.body?.clientId, 'clientId', { max: 64 });
    if (clientId && !/^[\w-]{8,64}$/.test(clientId)) throw bad('clientId is invalid');

    const title = getTitleById(db, titleId);
    const isAdmin = req.user?.role === 'admin';
    if (!title || (title.status !== 'published' && !isAdmin)) throw new HttpError(404, 'Title not found');

    const now = Date.now();
    const level = userLevel(db, req.user, now);
    if (!canWatch(level, title.min_tier)) throw upgradeError(req.user, title);

    // ---- resolve the source ----
    let url;
    let epId = 0;
    if (title.type === 'movie') {
      if (episodeId) throw bad('movies have no episodes');
      url = title.video_url;
    } else {
      if (!episodeId) throw bad('episodeId is required for series and anime');
      const ep = db.prepare('SELECT id, video_url FROM episodes WHERE id = ? AND title_id = ?').get(episodeId, titleId);
      if (!ep) throw new HttpError(404, 'Episode not found');
      url = ep.video_url;
      epId = ep.id;
    }
    if (!url) throw new HttpError(404, 'This title has no video source yet.');

    // ---- simultaneous screens (signed-in users only) ----
    let sessionId = null;
    if (req.user) {
      if (!clientId) throw bad('clientId is required');
      db.exec('BEGIN IMMEDIATE');
      try {
        purge(now);
        // A tab starting a new playback replaces its own previous session.
        db.prepare('DELETE FROM playback_sessions WHERE user_id = ? AND client_id = ?').run(req.user.id, clientId);
        const screens = screensForLevel(level);
        const active = db.prepare('SELECT COUNT(*) AS c FROM playback_sessions WHERE user_id = ?').get(req.user.id).c;
        if (active >= screens) {
          db.exec('ROLLBACK');
          throw new HttpError(403,
            `Your plan allows ${screens} screen${screens > 1 ? 's' : ''} at a time. Stop playback on another device or upgrade.`,
            { code: 'screen_limit', screens });
        }
        sessionId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO playback_sessions (id, user_id, client_id, title_id, episode_id, started_at, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(sessionId, req.user.id, clientId, titleId, epId, now, now);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    }

    db.prepare("UPDATE titles SET views = views + 1 WHERE id = ? AND status = 'published'").run(titleId);
    res.json({
      sessionId,
      heartbeatSec: HEARTBEAT_SEC,
      source: { url, kind: sourceKind(url) },
    });
  });

  r.post('/playback/:id/heartbeat', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    const now = Date.now();
    const row = db.prepare('SELECT * FROM playback_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row || row.last_seen < now - SESSION_TTL_MS) {
      if (row) db.prepare('DELETE FROM playback_sessions WHERE id = ?').run(row.id);
      throw new HttpError(404, 'Playback session expired.', { code: 'session_expired' });
    }
    // Entitlement may have lapsed mid-stream (subscription period ended).
    const title = getTitleById(db, row.title_id);
    if (!title || !canWatch(userLevel(db, req.user, now), title.min_tier)) {
      db.prepare('DELETE FROM playback_sessions WHERE id = ?').run(row.id);
      throw new HttpError(403, 'Your subscription no longer covers this title.', {
        code: 'upgrade_required', requiredTier: title?.min_tier ?? 'silver',
      });
    }
    db.prepare('UPDATE playback_sessions SET last_seen = ? WHERE id = ?').run(now, row.id);
    res.json({ ok: true });
  });

  r.delete('/playback/:id', (req, res) => {
    if (req.user) {
      db.prepare('DELETE FROM playback_sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    }
    res.json({ ok: true });
  });

  return r;
}

