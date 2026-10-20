import { h, mount } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { link, navigate } from '../router.js';
import { toast, errorPanel, emptyPanel, TYPE_LABEL, epLabel } from '../ui.js';
import { TIER_LABEL } from '../state.js';
import { icon } from '../icons.js';

const AGE = ['0+', '6+', '12+', '16+', '18+'];
const TIERS = ['free', 'silver', 'gold', 'diamond'];
const EMBED_HELP = 'Direct MP4/HLS (.m3u8) file, or the official VK embed link from the video’s Share → Export (“Embed”) dialog: https://vkvideo.ru/video_ext.php?oid=…&id=…&hash=…  Ordinary vk.com/video… page links are not accepted.';

function labelled(id, label, control, hint) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

/** Shared create/edit form for a title. */
function titleForm({ initial = {}, editing = false, submitLabel, onSubmit }) {
  const pre = editing ? 'e' + initial.id : 'new';
  const err = h('p', { class: 'form-error', role: 'alert' });
  const type = h('select', { id: `${pre}-type`, name: 'type', disabled: editing },
    Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v, selected: initial.type === v }, l)));
  const videoField = labelled(`${pre}-video`, 'Video source',
    h('input', { id: `${pre}-video`, name: 'videoUrl', type: 'url', maxlength: 2000, value: initial.videoUrl ?? '', placeholder: 'https://…' }),
    `Movies only; series/anime get a source per episode. ${EMBED_HELP}`);
  const syncVideo = () => { videoField.hidden = type.value !== 'movie'; };
  type.addEventListener('change', syncVideo);
  syncVideo();

  const form = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const fd = new FormData(form);
      const num = (k) => (fd.get(k) ? Number(fd.get(k)) : null);
      const body = {
        name: fd.get('name'),
        synopsis: fd.get('synopsis'),
        year: num('year'),
        ageRating: fd.get('ageRating'),
        durationMin: num('durationMin'),
        genres: String(fd.get('genres')).split(',').map((s) => s.trim()).filter(Boolean),
        status: fd.get('status'),
        featured: fd.get('featured') === 'on',
        minTier: fd.get('minTier'),
        rightsNote: fd.get('rightsNote'),
      };
      if (!editing) body.type = type.value;
      if ((editing ? initial.type : type.value) === 'movie' && fd.get('videoUrl')) body.videoUrl = fd.get('videoUrl');
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await onSubmit(body);
        if (!editing) { form.reset(); syncVideo(); }
      } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
    },
  },
  labelled(`${pre}-type`, 'Type', type),
  labelled(`${pre}-name`, 'Name', h('input', { id: `${pre}-name`, name: 'name', type: 'text', required: true, maxlength: 120, value: initial.name ?? '' })),
  labelled(`${pre}-syn`, 'Synopsis', h('textarea', { id: `${pre}-syn`, name: 'synopsis', maxlength: 2000 }, initial.synopsis ?? '')),
  h('div', { class: 'inline-form' },
    labelled(`${pre}-year`, 'Year', h('input', { id: `${pre}-year`, name: 'year', type: 'number', min: 1888, max: 2100, value: initial.year ?? '' })),
    labelled(`${pre}-age`, 'Age', h('select', { id: `${pre}-age`, name: 'ageRating' }, AGE.map((a) => h('option', { value: a, selected: (initial.ageRating ?? '12+') === a }, a)))),
    labelled(`${pre}-dur`, 'Minutes', h('input', { id: `${pre}-dur`, name: 'durationMin', type: 'number', min: 1, max: 1000, value: initial.durationMin ?? '' }))),
  videoField,
  labelled(`${pre}-genres`, 'Genres', h('input', { id: `${pre}-genres`, name: 'genres', type: 'text', value: (initial.genres ?? []).join(', ') }), 'Comma-separated, up to 8.'),
  h('div', { class: 'inline-form' },
    labelled(`${pre}-status`, 'Status', h('select', { id: `${pre}-status`, name: 'status' },
      ['published', 'draft'].map((s) => h('option', { value: s, selected: (initial.status ?? 'published') === s }, s)))),
    h('div', { class: 'field' }, h('span', { class: 'sr-only' }, 'Featured'),
      h('label', { class: 'check', for: `${pre}-feat`, style: { marginTop: '28px' } },
        h('input', { id: `${pre}-feat`, name: 'featured', type: 'checkbox', checked: !!initial.featured }), 'Featured on home'))),
  labelled(`${pre}-tier`, 'Available on', h('select', { id: `${pre}-tier`, name: 'minTier' },
    TIERS.map((t) => h('option', { value: t, selected: (initial.minTier ?? 'free') === t }, t === 'free' ? 'Free (everyone)' : `${TIER_LABEL[t]} and above`))),
  'The lowest plan that can watch this title. Enforced by the server.'),
  labelled(`${pre}-rights`, 'Rights note', h('input', { id: `${pre}-rights`, name: 'rightsNote', type: 'text', maxlength: 500, value: initial.rightsNote ?? '' }),
    'Required for VK embeds: who owns the video or what licence/permission lets you show it here (e.g. “Own channel”, “CC-BY, Blender Foundation”). Do not embed videos you have no right to show.'),
  err,
  h('button', { class: 'btn', type: 'submit' }, submitLabel));
  return form;
}

export async function adminPage(ctx) {
  ctx.title('Admin — MovieOn');
  if (!state.user) {
    navigate(link('/login', { next: '/admin' }));
    return;
  }
  if (state.user.role !== 'admin') {
    return h('div', { class: 'page' }, emptyPanel('Admin access required', 'Your account does not have permission to view this page.'));
  }

  const tableHolder = h('div', { class: 'table-wrap' });
  const open = new Map(); // titleId -> 'edit' | 'episodes'
  let titles = [];
  let total = 0;

  async function refresh() {
    try {
      const data = await api.admin.titles();
      titles = data.items;
      total = data.total;
      paint();
    } catch (e) {
      tableHolder.replaceChildren(errorPanel(e.message, refresh));
    }
  }

  const act = (fn, okMsg) => async () => {
    try { await fn(); if (okMsg) toast(okMsg); await refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  function episodesPanel(t) {
    const box = h('div', { class: 'ep-admin' }, h('p', { class: 'muted' }, 'Loading episodes…'));
    const err = h('p', { class: 'form-error', role: 'alert' });

    async function load() {
      try {
        const d = await api.admin.episodes(t.id);
        d.episodes = d.items;
        const form = h('form', {
          novalidate: true,
          onSubmit: async (e) => {
            e.preventDefault();
            err.textContent = '';
            const fd = new FormData(form);
            try {
              await api.admin.addEpisode(t.id, {
                season: Number(fd.get('season') || 1), number: Number(fd.get('number')),
                name: fd.get('name'), durationMin: fd.get('durationMin') ? Number(fd.get('durationMin')) : null,
                videoUrl: fd.get('videoUrl'),
              });
              toast('Episode added');
              await load();
            } catch (ex) { err.textContent = ex.message; }
          },
        },
        h('div', { class: 'inline-form' },
          h('input', { name: 'season', type: 'number', min: 1, placeholder: 'Season', 'aria-label': 'Season', value: 1 }),
          h('input', { name: 'number', type: 'number', min: 1, placeholder: 'Ep #', 'aria-label': 'Episode number', required: true }),
          h('input', { name: 'name', type: 'text', placeholder: 'Episode name', 'aria-label': 'Episode name', required: true, maxlength: 120 }),
          h('input', { name: 'durationMin', type: 'number', min: 1, placeholder: 'Minutes', 'aria-label': 'Minutes' }),
          h('input', { name: 'videoUrl', type: 'url', placeholder: 'MP4 / .m3u8 / VK embed link', 'aria-label': 'Video URL', required: true })),
        h('p', { class: 'hint muted' }, 'VK embeds need a rights note on the title first (Edit → Rights note).'),
        err,
        h('button', { class: 'btn small', type: 'submit', style: { marginTop: '8px' } }, 'Add episode'));

        box.replaceChildren(
          d.episodes.length
            ? h('ul', { class: 'ep-list' }, d.episodes.map((e) => h('li', { class: 'ep', style: { gridTemplateColumns: '70px 1fr auto' } },
              h('span', { class: 'muted' }, epLabel(e)),
              h('span', {}, e.name, e.sourceKind === 'embed' ? h('span', { class: 'tag outline', style: { marginLeft: '8px' } }, 'VK embed') : null),
              h('button', {
                class: 'btn danger small', type: 'button', 'aria-label': `Delete ${epLabel(e)} ${e.name}`,
                onClick: async () => {
                  try { await api.admin.deleteEpisode(e.id); toast('Episode deleted'); await load(); } catch (ex) { toast(ex.message, 'error'); }
                },
              }, 'Delete'))))
            : h('p', { class: 'muted' }, 'No episodes yet.'),
          form);
      } catch (e) { box.replaceChildren(errorPanel(e.message, load)); }
    }
    load();
    return box;
  }

  function paint() {
    if (!titles.length) {
      tableHolder.replaceChildren(emptyPanel('No titles yet', 'Use the form to add the first one.'));
      return;
    }
    const rows = titles.flatMap((t) => {
      const mode = open.get(t.id);
      const toggle = (m) => () => { if (open.get(t.id) === m) open.delete(t.id); else open.set(t.id, m); paint(); };
      const main = h('tr', {},
        h('td', {}, h('strong', {}, t.name), h('div', { class: 'muted' }, t.slug)),
        h('td', {}, TYPE_LABEL[t.type]),
        h('td', {}, h('span', { class: `tier tier-${t.minTier}` }, TIER_LABEL[t.minTier]), t.sourceKind === 'embed' ? h('div', { class: 'muted' }, 'VK embed') : null),
        h('td', {}, h('span', { class: `status ${t.status}` }, t.status), t.featured ? h('span', { class: 'feat-star', title: 'Featured on home' }, icon('star', { size: 14 }), h('span', { class: 'sr-only' }, 'Featured')) : null),
        h('td', {}, t.views),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'btn secondary small', type: 'button', onClick: toggle('edit') }, 'Edit'),
          t.type !== 'movie' ? h('button', { class: 'btn secondary small', type: 'button', onClick: toggle('episodes') }, 'Episodes') : null,
          h('button', {
            class: 'btn ghost small', type: 'button',
            onClick: act(() => api.admin.updateTitle(t.id, { status: t.status === 'published' ? 'draft' : 'published' }), t.status === 'published' ? 'Unpublished' : 'Published'),
          }, t.status === 'published' ? 'Unpublish' : 'Publish'),
          h('button', {
            class: 'btn danger small', type: 'button',
            onClick: () => { if (confirm(`Delete “${t.name}” permanently? This also removes its episodes, ratings and progress.`)) act(() => api.admin.deleteTitle(t.id), 'Title deleted')(); },
          }, 'Delete'))));
      if (!mode) return [main];
      const panel = mode === 'edit'
        ? titleForm({
          initial: t, editing: true, submitLabel: 'Save changes',
          onSubmit: async (body) => { await api.admin.updateTitle(t.id, body); toast('Saved'); open.delete(t.id); await refresh(); },
        })
        : episodesPanel(t);
      return [main, h('tr', {}, h('td', { colspan: 6 }, panel))];
    });
    mount(tableHolder,
      h('table', {},
        h('thead', {}, h('tr', {}, ['Title', 'Type', 'Access', 'Status', 'Views', 'Actions'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, rows)),
      total > titles.length ? h('p', { class: 'muted' }, `Showing the newest ${titles.length} of ${total}.`) : null);
  }

  function grantPanel() {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', {
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const fd = new FormData(form);
        try {
          await api.admin.grant({ email: fd.get('email'), plan: fd.get('plan'), days: Number(fd.get('days') || 30) });
          toast(`${TIER_LABEL[fd.get('plan')]} granted`);
          form.reset();
        } catch (ex) { err.textContent = ex.message; }
      },
    },
    labelled('g-email', 'User email', h('input', { id: 'g-email', name: 'email', type: 'email', required: true, maxlength: 254 })),
    h('div', { class: 'inline-form' },
      labelled('g-plan', 'Plan', h('select', { id: 'g-plan', name: 'plan' }, TIERS.slice(1).map((t) => h('option', { value: t }, TIER_LABEL[t])))),
      labelled('g-days', 'Days', h('input', { id: 'g-days', name: 'days', type: 'number', min: 1, max: 366, value: 30 }))),
    err,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', type: 'submit' }, 'Grant plan'),
      h('button', {
        class: 'btn danger', type: 'button',
        onClick: async () => {
          err.textContent = '';
          const email = new FormData(form).get('email');
          if (!email) { err.textContent = 'Enter the user’s email first.'; return; }
          if (!confirm(`Remove the subscription of ${email}?`)) return;
          try { await api.admin.revoke(email); toast('Subscription removed'); } catch (ex) { err.textContent = ex.message; }
        },
      }, 'Revoke')));
    return h('section', { class: 'card-panel', 'aria-label': 'Grant subscription', style: { marginTop: '24px' } },
      h('h2', {}, 'Grant a plan'),
      h('p', { class: 'muted' }, 'Gives a user a plan without a payment (support, partners, testing).'),
      form);
  }

  refresh();
  return h('div', { class: 'page' },
    h('h1', {}, 'Admin'),
    h('div', { class: 'admin-grid' },
      h('section', { class: 'card-panel', 'aria-label': 'Add title' },
        h('h2', {}, 'Add title'),
        titleForm({
          submitLabel: 'Create title',
          onSubmit: async (body) => { const r = await api.admin.createTitle(body); toast(`Created “${r.title.name}”`); await refresh(); },
        }),
        grantPanel()),
      h('section', { 'aria-label': 'Catalog' }, h('h2', {}, 'Catalog'), tableHolder)));
}
