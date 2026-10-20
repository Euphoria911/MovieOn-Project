/** Small validation / helper utilities shared by routes. */

export class HttpError extends Error {
  /** @param extra additional JSON fields returned to the client (e.g. a machine-readable `code`) */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg) => new HttpError(400, msg);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function str(value, name, { min = 0, max = 500, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${name} is required`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`${name} must be a string`);
  const v = value.trim();
  if (required && v.length === 0) throw bad(`${name} is required`);
  if (v.length < min) throw bad(`${name} must be at least ${min} characters`);
  if (v.length > max) throw bad(`${name} must be at most ${max} characters`);
  return v;
}

export function email(value) {
  const v = str(value, 'email', { required: true, max: 254 });
  if (!EMAIL_RE.test(v)) throw bad('email is invalid');
  return v.toLowerCase();
}

export function int(value, name, { min = -Infinity, max = Infinity, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw bad(`${name} must be an integer`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

export function num(value, name, { min = 0, max = 1e9 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

export function httpUrl(value, name, { required = false } = {}) {
  const v = str(value, name, { required, max: 2000 });
  if (!v) return null;
  let u;
  try {
    u = new URL(v);
  } catch {
    throw bad(`${name} must be a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw bad(`${name} must start with http:// or https://`);
  }
  return u.toString();
}

export function oneOf(value, name, allowed, { required = false } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (!allowed.includes(value)) throw bad(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function slugify(text) {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'title';
}

/** Wrap async handlers (Express 5 already forwards rejections, kept for clarity). */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Minimal Cookie header parser. */
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}
