import { h } from '../dom.js';
import { api } from '../api.js';
import { state, TIER_LABEL } from '../state.js';
import {
  poster, stars, toast, skeletonGrid, errorPanel, emptyPanel, tierBadge, TYPE_LABEL, epLabel, pickEpisode, ratingNode, fmtTime,
} from '../ui.js';
import { icon } from '../icons.js';
import { link, navigate } from '../router.js';

export async function titlePage(ctx) {
  ctx.mount(h('div', { class: 'page' }, skeletonGrid(1)));
  let d;
  try {
    d = await api.title(ctx.params.slug, { signal: ctx.signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (e.status === 404) {
      ctx.title('Not found — MovieOn');
      return h('div', { class: 'page' }, emptyPanel('Title not found', 'It may have been removed.'),
        h('p', { style: { textAlign: 'center' } }, h('a', { class: 'btn', href: '#/' }, 'Back to home')));
    }
    return h('div', { class: 'page' }, errorPanel(e.message, () => navigate(location.hash)));
  }
  ctx.title(`${d.name} — MovieOn`);

  const isMovie = d.type === 'movie';
  const prog = new Map(d.progress.map((p) => [p.episodeId, p]));
  const unfinishedPos = (p) => (p && p.duration > 0 && p.position / p.duration < 0.95 && p.position > 5 ? p.position : 0);

  // ---- primary action ----
  let playLabel;
  let playHref;
  if (isMovie) {
    const pos = unfinishedPos(prog.get(0));
    playLabel = pos ? `Resume from ${fmtTime(pos)}` : 'Play';
    playHref = `#/watch/${d.slug}`;
  } else {
    const ep = pickEpisode(d);
    if (ep) {
      const pos = unfinishedPos(prog.get(ep.id));
      playLabel = `${pos || prog.size ? 'Continue' : 'Play'} ${epLabel(ep)}`;
      playHref = `#/watch/${d.slug}?ep=${ep.id}`;
    }
  }

  // ---- watchlist ----
  let inList = d.inWatchlist;
  const listBtn = h('button', { class: 'btn secondary btn-list', type: 'button', onClick: toggleList });
  const paintList = () => {
    listBtn.replaceChildren(icon(inList ? 'check' : 'plus', { size: 17 }), inList ? 'In My List' : 'My List');
    listBtn.setAttribute('aria-pressed', String(inList));
    listBtn.classList.toggle('on', inList);
  };
  paintList();
  async function toggleList() {
    if (!state.user) return navigate(link('/login', { next: `/title/${d.slug}` }));
    listBtn.disabled = true;
    try {
      if (inList) await api.removeFromWatchlist(d.id); else await api.addToWatchlist(d.id);
      inList = !inList;
      paintList();
      toast(inList ? 'Added to My List' : 'Removed from My List');
    } catch (e) { toast(e.message, 'error'); } finally { listBtn.disabled = false; }
  }

  // ---- rating ----
  let agg = { avgRating: d.avgRating, ratingCount: d.ratingCount };
  let mine = d.myRating ?? 0;
  const ratingBox = h('div', {});
  const avgText = h('span', { class: 'avg' });
  const paintRating = () => {
    avgText.replaceChildren(ratingNode(agg));
    ratingBox.replaceChildren(state.user
      ? h('div', {}, h('span', { class: 'muted' }, mine ? 'Your rating ' : 'Rate this '), stars(mine, pick))
      : h('span', { class: 'muted' }, h('a', { href: link('/login', { next: `/title/${d.slug}` }), style: { textDecoration: 'underline' } }, 'Sign in'), ' to rate'));
  };
  async function pick(n) {
    try {
      const r = await api.rate(d.id, n);
      mine = r.myRating;
      agg = r;
      paintRating();
      toast('Thanks for rating!');
    } catch (e) { toast(e.message, 'error'); }
  }
  paintRating();

  // ---- episodes ----
  let episodes = null;
  if (!isMovie) {
    if (!d.episodes.length) {
      episodes = h('section', { class: 'episodes' }, h('h2', {}, 'Episodes'), h('p', { class: 'muted' }, 'No episodes yet.'));
    } else {
      const seasons = Map.groupBy(d.episodes, (e) => e.season);
      episodes = h('section', { class: 'episodes', 'aria-label': 'Episodes' },
        h('h2', {}, 'Episodes'),
        [...seasons].map(([s, eps]) => h('div', {},
          seasons.size > 1 ? h('h3', { class: 'season-title' }, `Season ${s}`) : null,
          h('ul', { class: 'ep-list' }, eps.map((e, n) => {
            const p = prog.get(e.id);
            const ratio = p?.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
            return h('li', { class: 'enter', vars: { '--i': Math.min(n, 14) } }, h('a', { class: 'ep', href: `#/watch/${d.slug}?ep=${e.id}` },
              h('span', { class: 'ep-num' }, e.number),
              h('span', {}, h('div', { class: 'ep-name' }, e.name),
                h('div', { class: 'ep-sub' }, [e.durationMin ? `${e.durationMin} min` : null, ratio >= 0.95 ? 'Watched' : null].filter(Boolean).join(' · '))),
              h('span', { class: 'ep-go', 'aria-hidden': 'true' }, icon('play', { size: 16 })),
              ratio > 0 ? h('div', { class: 'progress-bar' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })) : null));
          })))));
    }
  }

  const locked = !d.canWatch;
  const playBtn = !d.hasSource ? h('span', { class: 'muted' }, 'Not available yet')
    : locked
      ? h('a', { class: 'btn btn-unlock', href: state.user ? '#/plans' : link('/login', { next: '/plans' }) }, icon('lock', { size: 17 }), `Unlock with ${TIER_LABEL[d.minTier]}`)
      : (playHref ? h('a', { class: 'btn btn-play', href: playHref }, icon('play', { size: 18 }), playLabel) : h('span', { class: 'muted' }, 'Not available yet'));

  return h('div', { class: 'page' },
    h('article', { class: 'detail' },
      poster(d),
      h('div', {},
        h('h1', {}, d.name),
        h('div', { class: 'detail-meta' },
          tierBadge(d.minTier),
          h('span', { class: 'tag outline' }, TYPE_LABEL[d.type]),
          d.year ? h('span', { class: 'tag outline' }, d.year) : null,
          h('span', { class: 'tag outline' }, d.ageRating),
          isMovie && d.durationMin ? h('span', { class: 'tag outline' }, `${d.durationMin} min`) : null,
          d.genres.map((g) => h('a', { class: 'chip', href: link('/browse', { type: d.type, genre: g }) }, g)),
          avgText),
        h('p', {}, d.synopsis),
        h('div', { class: 'detail-actions' },
          playBtn,
          listBtn),
        locked && d.hasSource ? h('p', { class: 'notice' },
          `This title is included with ${TIER_LABEL[d.minTier]} and above.`,
          ' ', h('a', { href: '#/plans', style: { textDecoration: 'underline' } }, 'See plans')) : null,
        ratingBox)),
    episodes);
}
