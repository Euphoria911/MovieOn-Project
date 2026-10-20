import { h } from '../dom.js';
import { api } from '../api.js';
import { card, row, skeletonGrid, errorPanel, tierBadge, TYPE_LABEL, epLabel, fmtTime } from '../ui.js';
import { icon } from '../icons.js';
import { link } from '../router.js';
import { canWatchTier, TIER_LABEL } from '../state.js';

function hero(items, ctx) {
  let idx = 0;
  const box = h('section', { class: 'hero', 'aria-roledescription': 'carousel', 'aria-label': 'Featured titles' });
  const dots = h('div', { class: 'hero-dots' });
  let timer = null;

  function render() {
    const t = items[idx];
    box.style.setProperty('--h1', t.hue1);
    box.style.setProperty('--h2', t.hue2);
    box.replaceChildren(
      h('span', { class: 'hero-art', 'aria-hidden': 'true' }, t.name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase()),
      h('div', { class: 'hero-body' },
        h('div', { class: 'hero-tags' },
          tierBadge(t.minTier),
          h('span', { class: 'tag' }, TYPE_LABEL[t.type]),
          t.year ? h('span', { class: 'tag' }, t.year) : null,
          h('span', { class: 'tag' }, t.ageRating),
          t.genres.slice(0, 3).map((g) => h('span', { class: 'tag' }, g))),
        h('h1', {}, t.name),
        h('p', {}, t.synopsis),
        h('div', { class: 'hero-actions' },
          canWatchTier(t.minTier)
            ? h('a', { class: 'btn btn-play', href: `#/watch/${t.slug}` }, icon('play', { size: 18 }), 'Play')
            : h('a', { class: 'btn btn-unlock', href: '#/plans' }, icon('lock', { size: 17 }), `Unlock with ${TIER_LABEL[t.minTier]}`),
          h('a', { class: 'btn secondary', href: `#/title/${t.slug}` }, icon('info', { size: 18 }), 'More info'))),
      dots,
    );
    dots.replaceChildren(...items.map((it, i) => h('button', {
      type: 'button', 'aria-label': `Show ${it.name}`, 'aria-current': String(i === idx),
      onClick: () => { idx = i; render(); restart(); },
    })));
  }

  function restart() {
    clearInterval(timer);
    if (items.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setInterval(() => { idx = (idx + 1) % items.length; render(); }, 8000);
  }
  box.addEventListener('mouseenter', () => clearInterval(timer));
  box.addEventListener('focusin', () => clearInterval(timer));
  box.addEventListener('mouseleave', restart);
  ctx.onCleanup(() => clearInterval(timer));
  render();
  restart();
  return box;
}

export async function homePage(ctx) {
  ctx.title('MovieOn — movies, series & anime');
  ctx.mount(h('div', { class: 'page' }, skeletonGrid(6)));
  let data;
  try {
    data = await api.home();
  } catch (e) {
    return h('div', { class: 'page' }, errorPanel(e.message, () => homePage(ctx).then((n) => n && ctx.mount(n))));
  }

  const cont = data.continueWatching.length
    ? row('Continue watching', data.continueWatching, {
      renderItem: (it) => card(it, {
        href: `#/watch/${it.slug}${it.episode ? `?ep=${it.episode.id}` : ''}`,
        sub: [it.episode ? epLabel(it.episode) : null, it.position > 0 ? `at ${fmtTime(it.position)}` : 'up next']
          .filter(Boolean).join(' · '),
        progress: it.percent,
      }),
    })
    : null;

  return h('div', {},
    data.hero.length ? hero(data.hero, ctx) : null,
    h('div', { class: 'page' },
      cont,
      data.rows.map((r) => row(r.title, r.items, {
        moreHref: r.tier ? link('/browse', { tier: r.tier }) : r.type ? link('/browse', { type: r.type }) : link('/browse', { sort: r.key === 'trending' ? 'popular' : 'newest' }),
      }))));
}
