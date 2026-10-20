import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { makeAuth } from './auth.js';
import { HttpError } from './util.js';
import { authRoutes } from './routes/auth.js';
import { titleRoutes } from './routes/titles.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';
import { billingRoutes } from './routes/billing.js';
import { playbackRoutes } from './routes/playback.js';
import { EMBED_HOSTS } from './sources.js';

const HERE = import.meta.dirname;

/**
 * Build the Express app.
 * @param db        better-sqlite3 database
 * @param opts.secret        JWT signing secret (required)
 * @param opts.secureCookie  mark the session cookie Secure (default: production)
 * @param opts.rateLimit     enable rate limiting (default true; tests disable it)
 * @param opts.log           write one JSON line per request
 * @param opts.webDir        directory with the static client
 * @param opts.mediaOrigins  array of allowed media origins for CSP (default: any https)
 * @param opts.trustProxy    value for Express "trust proxy"
 * @param opts.billingProvider 'mock' enables the demo checkout; anything else disables payments (default)
 */
export function createApp(db, opts = {}) {
  const isProd = opts.production ?? process.env.NODE_ENV === 'production';
  const {
    secret,
    secureCookie = isProd,
    rateLimit: limitOn = true,
    log = false,
    webDir = path.join(HERE, '..', '..', 'web'),
    mediaOrigins = null,
    trustProxy = null,
    billingProvider = 'none',
  } = opts;
  if (!secret) throw new Error('createApp: opts.secret is required');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy !== null) app.set('trust proxy', trustProxy);

  const media = mediaOrigins?.length ? mediaOrigins : ['https:'];
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'media-src': ["'self'", 'blob:', ...media],
          'connect-src': ["'self'", ...media],
          'frame-src': EMBED_HOSTS.map((h) => `https://${h}`), // official VK embed player only
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          // Only when actually served over HTTPS; on plain http these would break the page.
          ...(secureCookie ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      strictTransportSecurity: !!secureCookie,
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (log) {
    app.use((req, res, next) => {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(JSON.stringify({
          t: new Date().toISOString(), m: req.method, p: req.originalUrl.split('?')[0],
          s: res.statusCode, ms: Math.round(ms * 10) / 10, u: req.user?.id ?? null,
        }));
      });
      next();
    });
  }

  const passthrough = (_req, _res, next) => next();
  const mkLimiter = (windowMs, limit) =>
    limitOn
      ? rateLimit({
          windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
          message: { error: 'Too many requests, please try again later' },
        })
      : passthrough;
  const apiLimiter = mkLimiter(60_000, 300);
  const authLimiter = mkLimiter(15 * 60_000, 20);

  const auth = makeAuth(db, { secret, secureCookie });

  // ---------- API ----------
  const api = express.Router();
  api.use(apiLimiter);
  api.use(express.json({ limit: '100kb' }));

  // CSRF defence in depth: same-origin check for state-changing calls.
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* invalid */ }
      if (host !== req.headers.host) return next(new HttpError(403, 'Cross-origin request blocked'));
    }
    next();
  });

  api.use(auth.attachUser);

  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRoutes(db, auth, { authLimiter }));
  api.use(titleRoutes(db));
  api.use(billingRoutes(db, auth, { provider: billingProvider }));
  api.use(playbackRoutes(db));
  api.use(meRoutes(db, auth));
  api.use('/admin', adminRoutes(db, auth));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/api', api);

  // ---------- Static client ----------
  const hlsFile = path.join(HERE, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js');
  app.get('/vendor/hls.min.js', (_req, res, next) => {
    if (!fs.existsSync(hlsFile)) return next();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(hlsFile);
  });
  app.use(express.static(webDir, { maxAge: isProd ? '1h' : 0, index: 'index.html' }));
  app.use((_req, res) => res.status(404).type('text').send('Not found'));

  // ---------- Errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = 500;
    let message = 'Internal server error';
    let extra = {};
    if (err instanceof HttpError) {
      status = err.status;
      message = err.message;
      extra = err.extra ?? {};
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body';
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      message = 'Request body too large';
    } else {
      console.error('[error]', req.method, req.originalUrl, err);
    }
    if (res.headersSent) return;
    res.status(status).json({ error: message, ...extra });
  });

  return app;
}
