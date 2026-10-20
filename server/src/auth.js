import jwt from 'jsonwebtoken';
import { HttpError, parseCookies } from './util.js';

export const COOKIE_NAME = 'mo_token';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function makeAuth(db, { secret, secureCookie }) {
  const getUser = db.prepare('SELECT id, email, username, role, created_at FROM users WHERE id = ?');

  function sign(userId) {
    return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
  }

  function setCookie(res, userId) {
    res.cookie(COOKIE_NAME, sign(userId), {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: MAX_AGE_MS,
      path: '/',
    });
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: secureCookie, path: '/' });
  }

  /** Populates req.user (or null). Role is always read from the DB. */
  function attachUser(req, _res, next) {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      try {
        const payload = jwt.verify(token, secret);
        req.user = getUser.get(payload.sub) ?? null;
      } catch {
        /* invalid/expired token → anonymous */
      }
    }
    next();
  }

  function requireAuth(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    next();
  }

  function requireAdmin(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Admin access required'));
    next();
  }

  return { setCookie, clearCookie, attachUser, requireAuth, requireAdmin };
}

export const publicUser = (u) => (u ? { id: u.id, email: u.email, username: u.username, role: u.role } : null);
