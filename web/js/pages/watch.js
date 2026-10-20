import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { link, navigate } from '../router.js';
import { errorPanel, emptyPanel, epLabel, pickEpisode, tierBadge, TYPE_LABEL } from '../ui.js';
import { icon, equalizer, spinner } from '../icons.js';
import { TIER_LABEL } from '../state.js';

const SAVE_EVERY_MS = 10_000;
const FINISHED = 0.95;
const NEXT_COUNTDOWN_S = 8;

/** One id per browser tab: starting playback again in the same tab replaces its own screen slot. */
function tabClientId() {
  try {
    let id = sessionStorage.getItem('movieon:client');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('movieon:client', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

let hlsLoader = null;
function loadHlsLib() {
  if (window.Hls) return Promise.resolve();
  hlsLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/hls.min.js';
    s.onload = resolve;
    s.onerror = () => { hlsLoader = null; reject(new Error('hls.js failed to load')); };
    document.head.append(s);
  });
  return hlsLoader;
}

export async function watchPage(ctx) {
  ctx.mount(h('div', { class: 'page' }, h('div', { class: 'player-box skeleton' })));
  let d;
  try {
    d = await api.title(ctx.params.slug, { signal: ctx.signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    return h('div', { class: 'page' }, e.status === 404
      ? emptyPanel('Title not found', 'It may have been removed.')
      : errorPanel(e.message, () => navigate(location.hash)));
  }

  const isMovie = d.type === 'movie';
  let ep = null;
  if (!isMovie) {
    const wanted = Number(ctx.query.ep);
    ep = d.episodes.find((e) => e.id === wanted) ?? pickEpisode(d);
    if (!ep) return h('div', { class: 'page' }, emptyPanel('No episodes yet', 'Check back soon.'));
  }
  if (!d.hasSource) return h('div', { class: 'page' }, errorPanel('This title has no video source yet.'));

  const label = ep ? `${d.name} — ${epLabel(ep)} ${ep.name}` : d.name;
  ctx.title(`${label} — MovieOn`);

  const idx = ep ? d.episodes.findIndex((e) => e.id === ep.id) : -1;
  const nextEp = idx >= 0 ? d.episodes[idx + 1] : null;
  const saved = d.progress.find((p) => p.episodeId === (ep?.id ?? 0));
  let resumeAt = saved && saved.duration > 0 && saved.position / saved.duration < FINISHED && saved.position > 5
    ? saved.position : 0;

  // ---------- player ----------
  const video = h('video', { controls: true, playsinline: true, preload: 'metadata', 'aria-label': label });
  const overlay = h('div', { class: 'player-overlay', hidden: true });
  const box = h('div', { class: 'player-box' }, video, overlay);

  let hls = null;
  let countdown = null;
  let lastSave = 0;
  let embedMode = false;
  let iframe = null;
  let session = null; // { id, heartbeatSec }
  let beat = null;
  let stopped = false;
  const clientId = tabClientId();

  const loader = h('div', { class: 'player-loader', hidden: true }, spinner());
  box.append(loader);
  const setLoading = (on) => { loader.hidden = !on; };
  const hideOverlay = () => { clearInterval(countdown); overlay.hidden = true; overlay.replaceChildren(); };
  const showOverlay = (...nodes) => { setLoading(false); overlay.replaceChildren(...nodes); overlay.hidden = false; };
  const gateIcon = (name, tone = '') => h('div', { class: `gate-icon ${tone}` }, icon(name, { size: 34 }));

  function destroyHls() { hls?.destroy(); hls = null; }

  // ---- playback authorization: the video URL only exists after the server approved this request ----
  function stopSession() {
    clearInterval(beat);
    beat = null;
    if (session?.id) api.stopPlayback(session.id).catch(() => {}); // keepalive: survives page unload
    session = null;
  }

  function startBeat(sec) {
    clearInterval(beat);
    if (!session?.id) return; // anonymous viewers on free titles have no screen slot
    beat = setInterval(async () => {
      if (stopped || !session?.id) return;
      try {
        await api.heartbeat(session.id);
      } catch (e) {
        if (e.code === 'upgrade_required') { video.pause(); iframe?.remove(); iframe = null; gate(e); stopSession(); return; }
        if (e.status === 404) { // slot was purged (e.g. laptop slept): try to take a new one
          try { await begin(); } catch (e2) { video.pause(); iframe?.remove(); iframe = null; gate(e2); }
        }
      }
    }, (sec || 30) * 1000);
  }

  async function begin() {
    const r = await api.startPlayback({ titleId: d.id, episodeId: ep?.id, clientId });
    session = r.sessionId ? { id: r.sessionId } : null;
    startBeat(r.heartbeatSec);
    return r.source;
  }

  /** Server said no: show the reason with the right next step. */
  function gate(e) {
    const retry = h('button', { class: 'btn secondary', type: 'button', onClick: load }, icon('retry', { size: 16 }), 'Try again');
    const back = h('a', { class: 'btn ghost', href: `#/title/${d.slug}` }, icon('arrowL', { size: 16 }), 'Back to title');
    if (e.code === 'login_required') {
      showOverlay(h('div', { role: 'alert' },
        gateIcon('user'),
        h('h2', {}, 'Sign in to watch'),
        h('p', {}, `This title is part of the ${TIER_LABEL[e.data?.requiredTier] ?? 'paid'} plan. Sign in to continue.`),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: link('/login', { next: `/watch/${d.slug}${ep ? `?ep=${ep.id}` : ''}` }) }, 'Sign in'),
          h('a', { class: 'btn secondary', href: '#/plans' }, 'See plans'), back)));
    } else if (e.code === 'upgrade_required') {
      showOverlay(h('div', { role: 'alert' },
        gateIcon('lock', 'shake'),
        h('h2', {}, `Included with ${TIER_LABEL[e.data?.requiredTier] ?? 'a paid plan'}`),
        h('p', {}, 'Upgrade your plan to watch this title.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-unlock', href: '#/plans' }, icon('sparkle', { size: 16 }), 'See plans'), back)));
    } else if (e.code === 'screen_limit') {
      showOverlay(h('div', { role: 'alert' },
        gateIcon('monitor', 'pulse'),
        h('h2', {}, 'Too many screens'),
        h('p', {}, `Your plan allows ${e.data?.screens ?? 1} screen${(e.data?.screens ?? 1) === 1 ? '' : 's'} at a time. Stop playback on another device or tab, then try again.`),
        h('div', { class: 'actions' }, retry, h('a', { class: 'btn secondary', href: '#/plans' }, 'More screens'), back)));
    } else {
      fail(e.message || 'The video could not be loaded.');
    }
  }

  function mountEmbed(url) {
    embedMode = true;
    embedHint.hidden = false;
    saveHint.hidden = true;
    keysHint.hidden = true;
    video.hidden = true;
    iframe?.remove();
    iframe = h('iframe', {
      class: 'embed-frame', src: url, title: label,
      // Official VK player only; sandboxed so it cannot navigate this page.
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
      allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
      allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'eager',
    });
    iframe.addEventListener('load', () => setLoading(false));
    box.prepend(iframe);
  }

  async function load() {
    hideOverlay();
    setLoading(true);
    destroyHls();
    iframe?.remove(); iframe = null; embedMode = false; video.hidden = false; embedHint.hidden = true; saveHint.hidden = false; keysHint.hidden = false;
    let source;
    try {
      source = await begin();
    } catch (e) {
      if (e.name === 'AbortError') return;
      gate(e);
      return;
    }
    if (stopped) return;
    const src = source.url;
    if (source.kind === 'embed') { mountEmbed(src); return; }

    const onMeta = () => {
      if (resumeAt > 0 && Number.isFinite(video.duration) && resumeAt < video.duration - 5) video.currentTime = resumeAt;
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });

    const isHls = /\.m3u8(\?|$)/i.test(src);
    try {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        await loadHlsLib();
        if (!window.Hls?.isSupported()) throw new Error('Your browser cannot play this stream.');
        hls = new window.Hls({ maxBufferLength: 30 });
        hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data.fatal) fail('The stream could not be loaded.'); });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else {
        video.src = src;
      }
      await video.play().catch(() => { /* autoplay blocked: user presses play */ });
    } catch (e) {
      fail(e.message || 'The video could not be loaded.');
    }
  }

  function fail(msg) {
    resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : resumeAt;
    showOverlay(h('div', { role: 'alert' },
      gateIcon('alert', 'pulse'),
      h('h2', {}, 'Playback problem'),
      h('p', {}, msg),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onClick: load }, icon('retry', { size: 16 }), 'Retry'),
        h('a', { class: 'btn secondary', href: `#/title/${d.slug}` }, 'Back to title'))));
  }

  video.addEventListener('error', () => fail('The video source is unavailable.'));
  video.addEventListener('playing', () => { setLoading(false); hideOverlay(); });
  video.addEventListener('waiting', () => { if (!video.paused) setLoading(true); });
  video.addEventListener('canplay', () => setLoading(false));

  // ---------- progress persistence (FR-08) ----------
  function save(keepalive = false) {
    if (!state.user || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (video.currentTime < 1 && !video.ended) return;
    lastSave = Date.now();
    api.saveProgress({
      titleId: d.id, episodeId: ep?.id, position: video.currentTime, duration: video.duration,
    }, { keepalive }).catch(() => { /* non-critical */ });
  }
  video.addEventListener('timeupdate', () => { if (Date.now() - lastSave >= SAVE_EVERY_MS) save(); });
  video.addEventListener('pause', () => save());
  const onHide = () => { if (document.visibilityState === 'hidden') save(true); };
  const onPageHide = () => { save(true); stopSession(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  // ---------- next episode (FR-11) ----------
  video.addEventListener('ended', () => {
    save();
    if (!nextEp) return;
    let left = NEXT_COUNTDOWN_S;
    const go = () => { hideOverlay(); navigate(link(`/watch/${d.slug}`, { ep: nextEp.id })); };
    const num = h('span', { class: 'ring-num' }, String(left));
    const msg = h('p', { class: 'sr-only', 'aria-live': 'polite' }, `Next episode starts in ${left}s`);
    const ring = h('div', { class: 'ring', vars: { '--dur': `${NEXT_COUNTDOWN_S}s` }, 'aria-hidden': 'true' },
      h('svg', { viewBox: '0 0 64 64', width: 76, height: 76, fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round' },
        h('circle', { class: 'ring-bg', cx: 32, cy: 32, r: 27 }),
        h('circle', { class: 'ring-fg', cx: 32, cy: 32, r: 27 })),
      num);
    showOverlay(h('div', {},
      ring,
      h('p', { class: 'muted' }, 'Up next'),
      h('h2', {}, `${epLabel(nextEp)} · ${nextEp.name}`),
      msg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-play', type: 'button', onClick: go }, icon('play', { size: 18 }), 'Play now'),
        h('button', { class: 'btn secondary', type: 'button', onClick: hideOverlay }, 'Stay here'))));
    countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) go(); else { num.textContent = String(left); msg.textContent = `Next episode starts in ${left}s`; }
    }, 1000);
  });

  // ---------- keyboard shortcuts (FR-15) ----------
  function onKey(e) {
    if (embedMode) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const native = t === video || t.closest?.('button, a');
    switch (e.key) {
      case ' ': if (native) return; e.preventDefault(); video.paused ? video.play() : video.pause(); break;
      case 'ArrowRight': if (t === video) return; video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); break;
      case 'ArrowLeft': if (t === video) return; video.currentTime = Math.max(0, video.currentTime - 10); break;
      case 'f': case 'F': document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.(); break;
      case 'm': case 'M': video.muted = !video.muted; break;
      case 'n': case 'N': if (nextEp) navigate(link(`/watch/${d.slug}`, { ep: nextEp.id })); break;
      default:
    }
  }
  document.addEventListener('keydown', onKey);

  ctx.onCleanup(() => {
    stopped = true;
    save(true);
    stopSession();
    iframe?.remove();
    clearInterval(countdown);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    video.pause();
    destroyHls();
    video.removeAttribute('src');
    video.load();
  });

  // ---------- layout ----------
  const embedHint = h('p', { class: 'save-hint', hidden: true }, 'This video is played by VK’s own player. Watch progress and “Continue watching” are not tracked for it.');
  const saveHint = state.user
    ? h('p', { class: 'save-hint' }, 'Your progress is saved automatically.')
    : h('p', { class: 'save-hint' }, h('a', { href: link('/login', { next: `/watch/${d.slug}${ep ? `?ep=${ep.id}` : ''}` }), style: { textDecoration: 'underline' } }, 'Sign in'), ' to save your progress.');
  const keysHint = h('p', { class: 'save-hint' },
    'Shortcuts: ', h('span', { class: 'kbd' }, 'Space'), ' play/pause · ',
    h('span', { class: 'kbd', 'aria-label': 'Left arrow' }, icon('arrowL', { size: 12 })), ' ', h('span', { class: 'kbd', 'aria-label': 'Right arrow' }, icon('arrowR', { size: 12 })), ' ±10s · ',
    h('span', { class: 'kbd' }, 'F'), ' fullscreen · ', h('span', { class: 'kbd' }, 'M'), ' mute', nextEp ? [' · ', h('span', { class: 'kbd' }, 'N'), ' next'] : null);
  const info = h('div', { class: 'watch-info' },
    h('h1', {}, ep ? `${d.name}` : d.name),
    ep ? h('h2', {}, `${epLabel(ep)} · ${ep.name}`) : null,
    h('p', { class: 'muted' }, ep?.synopsis || d.synopsis),
    h('div', { class: 'detail-meta' },
      h('span', { class: 'tag outline' }, TYPE_LABEL[d.type]),
      h('span', { class: 'tag outline' }, d.ageRating),
      d.genres.map((g) => h('span', { class: 'tag outline' }, g))),
    embedHint,
    saveHint,
    keysHint,
    h('a', { class: 'btn ghost small', href: `#/title/${d.slug}` }, icon('arrowL', { size: 14 }), 'Title page'));

  let side = null;
  if (!isMovie) {
    side = h('aside', { class: 'side-panel', 'aria-label': 'Episodes' },
      h('h2', {}, 'Episodes'),
      h('ul', { class: 'ep-list' }, d.episodes.map((e, n) => h('li', { class: 'enter', vars: { '--i': Math.min(n, 14) } },
        h('a', { class: 'ep', href: link(`/watch/${d.slug}`, { ep: e.id }), 'aria-current': String(e.id === ep.id) },
          h('span', { class: 'ep-num' }, e.number),
          h('span', {}, h('div', { class: 'ep-name' }, e.name), h('div', { class: 'ep-sub' }, `Season ${e.season}`)),
          h('span', { class: 'ep-go', 'aria-hidden': 'true' }, e.id === ep.id ? equalizer() : icon('play', { size: 16 })))))));
  }

  setTimeout(load, 0); // after the router has mounted the player
  return h('div', { class: 'page' },
    h('div', { class: `watch ${isMovie ? 'single' : ''}` }, h('div', {}, box, info), side));
}
