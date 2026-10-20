import { h, $, mount } from './dom.js';
import { api } from './api.js';
import { state, loadUser, onUserChange, setUser, TIER_LABEL } from './state.js';
import { route, start, link, navigate, parseHash } from './router.js';
import { toast, tierBadge } from './ui.js';
import { icon } from './icons.js';
import { homePage } from './pages/home.js';
import { browsePage } from './pages/browse.js';
import { titlePage } from './pages/title.js';
import { watchPage } from './pages/watch.js';
import { loginPage, registerPage } from './pages/auth.js';
import { watchlistPage } from './pages/watchlist.js';
import { adminPage } from './pages/admin.js';
import { plansPage, checkoutPage } from './pages/plans.js';
import { accountPage } from './pages/account.js';

// ---- routes ----
route('/', homePage, { nav: () => 'home' });
route('/browse', browsePage, { nav: (q) => (q.tier === 'free' && !q.type ? 'free' : q.type || null) });
route('/search', browsePage, { nav: () => null });
route('/title/:slug', titlePage);
route('/watch/:slug', watchPage);
route('/login', loginPage);
route('/register', registerPage);
route('/watchlist', watchlistPage, { nav: () => 'watchlist' });
route('/plans', plansPage, { nav: () => 'plans' });
route('/checkout/:plan', checkoutPage, { nav: () => 'plans' });
route('/account', accountPage);
route('/admin', adminPage, { nav: () => 'admin' });

// ---- header ----
function paintAccount() {
  const u = state.user;
  mount($('#account'), u
    ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      h('a', { class: 'account-link', href: link('/account'), 'aria-label': `Account: ${u.username}` },
        h('span', { class: 'account-name' }, u.username),
        u.role === 'admin'
          ? h('span', { class: 'tier tier-diamond' }, icon('gem', { size: 12 }), 'Admin')
          : tierBadge(state.access.plan ?? 'free')),
      h('button', {
        class: 'btn secondary small', type: 'button',
        onClick: async () => {
          try { await api.logout(); } catch { /* cookie may already be gone */ }
          setUser(null);
          toast('Signed out');
          navigate('#/');
        },
      }, icon('arrowR', { size: 14 }), 'Sign out'))
    : h('div', { style: { display: 'flex', gap: '8px' } },
      h('a', { class: 'btn ghost small', href: link('/login') }, 'Sign in'),
      h('a', { class: 'btn small', href: link('/register') }, 'Sign up')));
  $('#admin-link').hidden = u?.role !== 'admin';
}
onUserChange(paintAccount);

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) navigate(link('/search', { q }));
});

// Keep the search box in sync with the URL (cleared when leaving search results).
function syncSearch() {
  const { path, query } = parseHash();
  $('#search-input').value = path === '/search' ? (query.q ?? '') : '';
}
window.addEventListener('hashchange', syncSearch);

// ---- motion helpers (all skipped under prefers-reduced-motion) ----
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Header gains a solid backdrop once the page is scrolled.
const header = $('#header');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Material-style ripple on buttons.
document.addEventListener('pointerdown', (e) => {
  if (reduceMotion.matches || e.button !== 0) return;
  const btn = e.target instanceof Element ? e.target.closest('.btn, .chip') : null;
  if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const dot = h('span', { class: 'ripple', 'aria-hidden': 'true', vars: {
    '--rs': `${size}px`, '--rx': `${e.clientX - r.left - size / 2}px`, '--ry': `${e.clientY - r.top - size / 2}px`,
  } });
  btn.append(dot);
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
  setTimeout(() => dot.remove(), 900);
}, { passive: true });

// Intro splash: once per browser session, skipped for reduced motion. Click / key skips it.
function splash() {
  let seen = false;
  try { seen = sessionStorage.getItem('mo_splash') === '1'; sessionStorage.setItem('mo_splash', '1'); } catch { /* storage blocked: show once per load */ }
  if (seen || reduceMotion.matches) return () => {};
  const el = h('div', { class: 'splash', 'aria-hidden': 'true' },
    h('div', { class: 'splash-mark', 'aria-hidden': 'true' },
      [...'MOVIEON'].map((c, i) => h('span', { class: i >= 5 ? 'on' : '', vars: { '--i': i } }, c))),
    h('div', { class: 'splash-line', 'aria-hidden': 'true' }));
  document.body.append(el);
  const started = performance.now();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  };
  el.addEventListener('pointerdown', close);
  addEventListener('keydown', close, { once: true });
  return () => setTimeout(close, Math.max(0, 1500 - (performance.now() - started)));
}
const endSplash = splash();

// ---- boot ----
await loadUser();
paintAccount();
syncSearch();
await start($('#app'));
endSplash();
