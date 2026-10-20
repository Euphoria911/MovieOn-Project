import { h, mount } from '../dom.js';
import { api } from '../api.js';
import { card, skeletonGrid, errorPanel, emptyPanel } from '../ui.js';
import { icon } from '../icons.js';
import { link, navigate } from '../router.js';

const TYPES = [['', 'All'], ['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']];
const SORTS = [['newest', 'Newest'], ['popular', 'Most watched'], ['rating', 'Top rated'], ['name', 'A–Z']];
const PLURAL = { movie: 'Movies', series: 'Series', anime: 'Anime' };

let genreCache = null;

export async function browsePage(ctx) {
  const { type = '', genre = '', sort = 'newest', page = '1', q = '', tier = '' } = ctx.query;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const heading = q ? `Results for “${q}”`
    : tier === 'free' ? (type ? `Free ${PLURAL[type]}` : 'Free to watch')
      : tier ? `${tier[0].toUpperCase()}${tier.slice(1)} titles${type ? ` · ${PLURAL[type]}` : ''}`
        : (PLURAL[type] ?? 'Browse everything');
  ctx.title(`${heading} — MovieOn`);

  const go = (over) => navigate(link(q ? '/search' : '/browse', { type, genre, sort, q, tier, page: 1, ...over }));
  const results = h('div', { 'aria-live': 'polite' }, skeletonGrid(12));

  const typeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Type' },
    TYPES.map(([v, label]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(type === v), onClick: () => go({ type: v, genre: '' }),
    }, label)));

  const tierChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Access' },
    [['', 'All titles'], ['free', 'Free'], ['silver', 'Silver'], ['gold', 'Gold'], ['diamond', 'Diamond']].map(([v, label]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(tier === v), onClick: () => go({ tier: v }),
    }, label)));

  const genreBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Genre' });
  const sortSel = h('select', { id: 'sort', onChange: (e) => go({ sort: e.target.value }) },
    SORTS.map(([v, label]) => h('option', { value: v, selected: v === sort }, label)));

  ctx.mount(h('div', { class: 'page' },
    h('h1', {}, heading),
    h('div', { class: 'toolbar' },
      typeChips,
      tierChips,
      h('div', {}, h('label', { for: 'sort', class: 'muted' }, 'Sort: '), sortSel)),
    genreBox,
    h('div', { style: { height: '20px' } }),
    results));

  async function loadGenres() {
    try {
      genreCache ??= (await api.genres()).genres;
      genreBox.replaceChildren(
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!genre), onClick: () => go({ genre: '' }) }, 'Any genre'),
        ...genreCache.map((g) => h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(genre.toLowerCase() === g.name.toLowerCase()),
          onClick: () => go({ genre: g.name }),
        }, g.name)));
    } catch { /* genre filter is optional */ }
  }

  async function loadResults() {
    results.replaceChildren(skeletonGrid(12));
    try {
      const data = await api.titles({ type, genre, sort, q, tier, page: pageNum, limit: 24 }, { signal: ctx.signal });
      if (ctx.isStale()) return;
      if (!data.items.length) {
        results.replaceChildren(emptyPanel('Nothing found', q ? 'Try a different search term.' : 'Try another filter.'));
        return;
      }
      mount(results,
        h('p', { class: 'muted' }, `${data.total} title${data.total === 1 ? '' : 's'}`),
        h('div', { class: 'grid' }, data.items.map((t, i) => card(t, { i }))),
        data.pages > 1
          ? h('nav', { class: 'pager', 'aria-label': 'Pagination' },
            h('button', { class: 'btn secondary', type: 'button', disabled: pageNum <= 1, onClick: () => go({ page: pageNum - 1 }) }, icon('arrowL', { size: 16 }), 'Previous'),
            h('span', { class: 'muted' }, `Page ${data.page} of ${data.pages}`),
            h('button', { class: 'btn secondary', type: 'button', disabled: pageNum >= data.pages, onClick: () => go({ page: pageNum + 1 }) }, 'Next', icon('arrowR', { size: 16 })))
          : null);
    } catch (e) {
      if (e.name === 'AbortError' || ctx.isStale()) return;
      results.replaceChildren(errorPanel(e.message, loadResults));
    }
  }

  loadGenres();
  await loadResults();
}
