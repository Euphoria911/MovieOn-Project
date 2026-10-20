import crypto from 'node:crypto';
import { openDb } from './db.js';
import { seedCatalog, ensureAdmin } from './seed.js';
import { createApp } from './app.js';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const PORT = Number(env.PORT ?? 3000);
const DB_PATH = env.DB_PATH ?? './data/movieon.db';

let secret = env.JWT_SECRET;
if (!secret) {
  if (isProd) {
    console.error('FATAL: JWT_SECRET must be set in production.');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] JWT_SECRET not set — using a random secret (sessions reset on restart).');
}

const db = openDb(DB_PATH);

if (env.SEED_DEMO !== 'false') {
  const n = seedCatalog(db);
  if (n) console.log(`[seed] inserted ${n} demo titles`);
}

// Admin bootstrap
if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
  if (ensureAdmin(db, { email: env.ADMIN_EMAIL.toLowerCase(), password: env.ADMIN_PASSWORD })) {
    console.log(`[admin] created admin ${env.ADMIN_EMAIL}`);
  }
} else if (!isProd) {
  if (ensureAdmin(db, { email: 'admin@movieon.local', password: 'admin12345' })) {
    console.warn('[admin] DEV admin created: admin@movieon.local / admin12345 (never use in production)');
  }
}

const mediaOrigins = env.MEDIA_ORIGINS ? env.MEDIA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const trustProxy = env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : null;

const billingProvider = env.BILLING_PROVIDER ?? (isProd ? 'none' : 'mock');
if (billingProvider === 'mock' && isProd) console.warn('[warn] BILLING_PROVIDER=mock in production: payments are simulated, no real money is charged.');

const app = createApp(db, {
  secret,
  billingProvider,
  // Set COOKIE_SECURE=true when served over HTTPS (also enables HSTS + upgrade-insecure-requests).
  secureCookie: env.COOKIE_SECURE === undefined || env.COOKIE_SECURE === '' ? isProd : env.COOKIE_SECURE === 'true',
  log: true,
  mediaOrigins,
  trustProxy,
  webDir: env.WEB_DIR || undefined,
});

const server = app.listen(PORT, () => {
  console.log(`MovieOn listening on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
});

function shutdown(signal) {
  console.log(`[${signal}] shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
