/**
 * Create an admin account, or reset the password / promote an existing account.
 *
 *   node src/admin-cli.js <email> <password>
 *   docker compose exec movieon node src/admin-cli.js <email> <password>
 *
 * Needed because v1.0 has no password-change or role-management UI.
 */
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8 || password.length > 72) {
  console.error('Usage: node src/admin-cli.js <email> <password (8–72 chars)>');
  process.exit(1);
}

const db = openDb(process.env.DB_PATH ?? './data/movieon.db');
const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(hash, existing.id);
  console.log(`Updated ${email}: password reset, role = admin.`);
} else {
  db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?, 'Admin', ?, 'admin')")
    .run(email.toLowerCase(), hash);
  console.log(`Created admin ${email}.`);
}
db.close();
