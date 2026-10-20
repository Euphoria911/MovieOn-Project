import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { link, navigate } from '../router.js';
import { card, skeletonGrid, errorPanel, emptyPanel, toast } from '../ui.js';
import { icon } from '../icons.js';

export async function watchlistPage(ctx) {
  ctx.title('My List — MovieOn');
  if (!state.user) {
    navigate(link('/login', { next: '/watchlist' }));
    return;
  }
  ctx.mount(h('div', { class: 'page' }, h('h1', {}, 'My List'), skeletonGrid(6)));
  let items;
  try {
    items = (await api.watchlist()).items;
  } catch (e) {
    return h('div', { class: 'page' }, h('h1', {}, 'My List'), errorPanel(e.message, () => navigate(location.hash)));
  }

  const grid = h('div', { class: 'grid' });
  const holder = h('div', {});
  const paint = () => {
    if (!items.length) {
      holder.replaceChildren(emptyPanel('Your list is empty', 'Add titles with the “+ My List” button on any title page.'),
        h('p', { style: { textAlign: 'center' } }, h('a', { class: 'btn', href: '#/browse' }, 'Browse the catalog')));
      return;
    }
    grid.replaceChildren(...items.map((t, i) => h('div', { class: 'card-holder', style: { position: 'relative' } },
      card(t, { i }),
      h('button', {
        class: 'btn secondary small card-remove', type: 'button', 'aria-label': `Remove ${t.name} from My List`,
        onClick: async (e) => {
          e.preventDefault();
          try {
            await api.removeFromWatchlist(t.id);
            items = items.filter((x) => x.id !== t.id);
            toast('Removed from My List');
            paint();
          } catch (err) { toast(err.message, 'error'); }
        },
      }, icon('close', { size: 14 }), 'Remove'))));
    holder.replaceChildren(h('p', { class: 'muted' }, `${items.length} title${items.length === 1 ? '' : 's'}`), grid);
  };
  paint();
  return h('div', { class: 'page' }, h('h1', {}, 'My List'), holder);
}
