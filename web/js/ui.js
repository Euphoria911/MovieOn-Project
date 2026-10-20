import { h } from './dom.js';
import { TIER_LABEL, canWatchTier } from './state.js';
import { icon, TIER_ICON } from './icons.js';

export const TYPE_LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime' };

export function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function epLabel(ep) {
  return `S${ep.season} · E${ep.number}`;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Small pill: FREE / SILVER / GOLD / DIAMOND, with a lock when the viewer's plan does not unlock it. */
export function tierBadge(tier, { lock = false } = {}) {
  const t = tier || 'free';
  return h('span', { class: `tier tier-${t}` },
    lock ? icon('lock', { size: 12 }) : (TIER_ICON[t] ? icon(TIER_ICON[t], { size: 12 }) : null), TIER_LABEL[t] ?? t);
}

export function poster(t, { progress, cta = true } = {}) {
  const locked = t.minTier && t.minTier !== 'free' && !canWatchTier(t.minTier);
  return h('div', { class: `poster ${locked ? 'locked' : ''}`, vars: { '--h1': t.hue1, '--h2': t.hue2 }, 'aria-hidden': 'true' },
    h('span', { class: 'poster-type' }, TYPE_LABEL[t.type] ?? t.type),
    t.ageRating ? h('span', { class: 'poster-age' }, t.ageRating) : null,
    t.minTier ? posterTier(t, locked) : null,
    cta ? h('span', { class: 'poster-cta' }, icon(locked ? 'lock' : 'play', { size: 26 })) : null,
    h('span', { class: 'poster-initials' }, initials(t.name)),
    progress > 0 ? h('div', { class: 'progress-bar' }, h('i', { style: { width: `${Math.round(progress * 100)}%` } })) : null,
  );
}

function posterTier(t, locked) {
  const badge = tierBadge(t.minTier, { lock: locked });
  badge.classList.add('poster-tier');
  return badge;
}

export function card(t, { sub, progress, href, i } = {}) {
  const meta = sub ?? [t.year, t.genres?.[0]].filter(Boolean).join(' · ');
  return h('a', { class: `card${i === undefined ? '' : ' enter'}`, vars: i === undefined ? undefined : { '--i': Math.min(i, 14) }, href: href ?? `#/title/${t.slug}`, 'aria-label': `${t.name}, ${TYPE_LABEL[t.type] ?? ''}${t.minTier && t.minTier !== 'free' ? `, ${TIER_LABEL[t.minTier]} plan` : ', free'}` },
    poster(t, { progress }),
    h('div', { class: 'card-title' }, t.name),
    meta ? h('div', { class: 'card-meta' }, meta) : null,
  );
}

export function row(title, items, { moreHref, renderItem = (t) => card(t) } = {}) {
  const scroller = h('div', { class: 'row-scroller', role: 'list' },
    items.map((it, i) => h('div', { role: 'listitem', class: 'enter', vars: { '--i': Math.min(i, 14) } }, renderItem(it))));
  const scrollBy = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: 'smooth' });
  const arrow = (dir) => h('button', {
    class: `icon-btn row-arrow ${dir < 0 ? 'prev' : 'next'}`, type: 'button',
    'aria-label': `Scroll ${title} ${dir < 0 ? 'left' : 'right'}`, onClick: () => scrollBy(dir),
  }, icon(dir < 0 ? 'chevL' : 'chevR', { size: 22 }));
  return h('section', { class: 'row', 'aria-label': title },
    h('div', { class: 'row-head' },
      h('h2', {}, title),
      moreHref ? h('a', { href: moreHref }, 'See all') : null),
    h('div', { class: 'row-wrap' }, arrow(-1), scroller, arrow(1)),
  );
}

export function skeletonGrid(n = 12) {
  return h('div', { class: 'grid', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: n }, () => h('div', {},
      h('div', { class: 'skeleton poster-sk' }), h('div', { class: 'skeleton line' }))));
}

export function errorPanel(message, onRetry) {
  return h('div', { class: 'error-panel', role: 'alert' },
    h('span', { class: 'panel-icon' }, icon('alert', { size: 34 })),
    h('p', {}, message),
    onRetry ? h('button', { class: 'btn secondary', type: 'button', onClick: onRetry }, icon('retry', { size: 16 }), 'Try again') : null);
}

export function emptyPanel(title, text) {
  return h('div', { class: 'empty' }, h('span', { class: 'panel-icon' }, icon('film', { size: 34 })), h('h2', {}, title), text ? h('p', {}, text) : null);
}

export function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  const err = type === 'error';
  const el = h('div', { class: `toast ${err ? 'error' : ''}` },
    h('span', { class: 'toast-icon' }, icon(err ? 'alert' : 'check', { size: 16 })),
    h('span', {}, message),
    h('span', { class: 'toast-timer', 'aria-hidden': 'true' }));
  while (box.children.length >= 3) box.firstElementChild.remove();
  box.append(el);
  const leave = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  setTimeout(leave, 4200);
}

/** Full-screen success moment (plan activated): drawn check + particle burst. Resolves when finished. */
export function celebrate(title, tier = 'gold') {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = 22;
  const particles = Array.from({ length: N }, (_, k) => h('i', {
    vars: { '--a': `${Math.round((360 / N) * k + (k % 2 ? 6 : -6))}deg`, '--d': `${90 + ((k * 37) % 70)}px`, '--s': String(0.6 + ((k * 13) % 7) / 10), '--k': String(k) },
  }));
  const el = h('div', { class: `celebrate cel-${tier}`, role: 'status' },
    h('div', { class: 'cel-stage' },
      h('div', { class: 'cel-burst', 'aria-hidden': 'true' }, particles),
      h('svg', { class: 'cel-ring', viewBox: '0 0 120 120', width: 120, height: 120, 'aria-hidden': 'true', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
        h('circle', { class: 'cel-circle', cx: 60, cy: 60, r: 52, pathLength: 1, 'stroke-width': 6 }),
        h('path', { class: 'cel-tick', d: 'M38 62l15 15 30-34', pathLength: 1, 'stroke-width': 8 })),
      h('p', { class: 'cel-title' }, title)));
  document.body.append(el);
  return new Promise((resolve) => setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 260); }, reduce ? 500 : 1700));
}

export function stars(value, onPick) {
  return h('div', { class: 'stars', role: 'group', 'aria-label': 'Your rating' },
    [1, 2, 3, 4, 5].map((n) => h('button', {
      class: `star ${value >= n ? 'on' : ''}`, type: 'button', 'aria-pressed': String(value === n), vars: { '--i': n },
      'aria-label': `${n} star${n > 1 ? 's' : ''}`, onClick: () => onPick(n),
    }, icon('star', { size: 26 }))));
}

/** Which episode should "Play / Continue" open? First one not finished. */
export function pickEpisode(detail) {
  const eps = detail.episodes ?? [];
  if (!eps.length) return null;
  const prog = new Map((detail.progress ?? []).map((p) => [p.episodeId, p]));
  const finished = (p) => p && p.duration > 0 && p.position / p.duration >= 0.95;
  return eps.find((e) => !finished(prog.get(e.id))) ?? eps[0];
}

export const ratingNode = (t) => (t.ratingCount
  ? h('span', { class: 'avg-val' }, icon('star', { size: 14 }), `${t.avgRating.toFixed(1)} (${t.ratingCount})`)
  : h('span', {}, 'No ratings yet'));
