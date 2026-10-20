import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { HttpError, email as vEmail, str, bad } from '../util.js';
import { publicUser } from '../auth.js';
import { accessFor } from '../entitlements.js';

// Used to equalise timing when the e-mail is unknown.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRoutes(db, auth, { authLimiter }) {
  const r = Router();

  r.post('/register', authLimiter, async (req, res) => {
    const email = vEmail(req.body?.email);
    const username = str(req.body?.username, 'username', { required: true, min: 2, max: 32 });
    if (!/^[\w .-]+$/u.test(username)) throw bad('username contains invalid characters');
    const password = str(req.body?.password, 'password', { required: true, min: 8, max: 72 });

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'This email is already registered');
    }
    const hash = await bcrypt.hash(password, 10);
    const info = db
      .prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'user')")
      .run(email, username, hash);
    const user = db.prepare('SELECT id, email, username, role FROM users WHERE id = ?').get(info.lastInsertRowid);
    auth.setCookie(res, user.id);
    res.status(201).json({ user: publicUser(user), access: accessFor(db, user) });
  });

  r.post('/login', authLimiter, async (req, res) => {
    const email = vEmail(req.body?.email);
    const password = str(req.body?.password, 'password', { required: true, max: 200 });
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'Invalid email or password');
    auth.setCookie(res, row.id);
    res.json({ user: publicUser(row), access: accessFor(db, row) });
  });

  r.post('/logout', (_req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user), access: accessFor(db, req.user) });
  });

  return r;
}
