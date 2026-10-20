import { mount } from './dom.js';
import { errorPanel } from './ui.js';
import { h } from './dom.js';

const routes = [];
let root;
let token = 0;
let cleanups = [];
let controller = null;

export function route(pattern, handler, { nav } = {}) {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/:([a-z]+)/gi, (_m, k) => { keys.push(k); return '([^/]+)'; })}/?$`,
  );
  routes.push({ re, keys, handler, nav });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(search)) };
}

/** Build an in-app hash URL: link('/browse', {type:'anime', page:2}) */
export function link(path, params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function navigate(hash) {
  if (location.hash === hash) dispatch();
  else location.hash = hash;
}

/** Only allow in-app paths as post-login redirect targets (no open redirects). */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

async function dispatch() {
  const myToken = ++token;
  for (const fn of cleanups.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
  controller?.abort();
  controller = new AbortController();

  const { path, query } = parseHash();
  let match = null;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      match = { r, params };
      break;
    }
  }

  document.querySelectorAll('[data-nav]').forEach((a) => a.removeAttribute('aria-current'));
  const navKey = match?.r.nav?.(query) ?? null;
  if (navKey) document.querySelector(`[data-nav="${navKey}"]`)?.setAttribute('aria-current', 'page');

  const ctx = {
    params: match?.params ?? {},
    query,
    signal: controller.signal,
    isStale: () => myToken !== token,
    onCleanup: (fn) => cleanups.push(fn),
    title: (t) => { if (myToken === token) document.title = t; },
    mount: (...nodes) => { if (myToken === token) mount(root, ...nodes); },
  };

  window.scrollTo(0, 0);
  const bar = document.documentElement.classList;
  bar.add('route-loading');
  try {
    if (!match) {
      ctx.title('Not found — MovieOn');
      ctx.mount(h('div', { class: 'page' }, h('div', { class: 'empty' },
        h('h1', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Back to home'))));
    } else {
      const out = await match.r.handler(ctx);
      if (out && myToken === token) mount(root, out);
    }
  } catch (e) {
    if (e?.name === 'AbortError' || myToken !== token) return;
    console.error(e);
    ctx.mount(h('div', { class: 'page' }, errorPanel(e?.message ?? 'Something went wrong.', dispatch)));
  }
  if (myToken === token) { bar.remove('route-loading'); root.focus({ preventScroll: true }); }
}

export function start(rootEl) {
  root = rootEl;
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}
