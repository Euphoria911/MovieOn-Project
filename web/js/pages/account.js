import { h } from '../dom.js';
import { api } from '../api.js';
import { state, setUser, TIER_LABEL } from '../state.js';
import { link, navigate } from '../router.js';
import { toast, errorPanel, tierBadge } from '../ui.js';
import { money } from './plans.js';

const fmtDate = (iso) => new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export async function accountPage(ctx) {
  ctx.title('Account — MovieOn');
  if (!state.user) {
    navigate(link('/login', { next: '/account' }));
    return;
  }
  const holder = h('div', {});

  async function load() {
    let data;
    try {
      data = await api.billing.subscription();
    } catch (e) {
      holder.replaceChildren(errorPanel(e.message, load));
      return;
    }
    setUser(state.user, data.access); // keep the header badge in sync (e.g. after expiry)
    paint(data);
  }

  const act = (fn, msg) => async () => {
    try { await fn(); toast(msg); await load(); } catch (e) { toast(e.message, 'error'); }
  };

  const data30 = 30;
  function paint({ subscription: sub, access, payments }) {
    const active = sub?.active;
    const plan = active ? sub.plan : null;
    const status = !sub ? 'Free plan'
      : !active ? `${TIER_LABEL[sub.plan]} expired on ${fmtDate(sub.currentPeriodEnd)}`
        : sub.status === 'canceled'
          ? `Canceled — access until ${fmtDate(sub.currentPeriodEnd)} (${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left)`
          : `Active — ${sub.provider === 'admin' ? 'granted by support, ends' : 'paid until'} ${fmtDate(sub.currentPeriodEnd)} (${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left)`;

    holder.replaceChildren(
      h('section', { class: 'card-panel', 'aria-label': 'Subscription' },
        h('h2', {}, 'Subscription'),
        h('p', {}, tierBadge(plan ?? 'free'), ' ', h('span', { id: 'sub-status' }, status)),
        active ? h('div', { class: 'meter', role: 'img', 'aria-label': `${sub.daysLeft} of ${data30} days left` }, h('i', { style: { width: `${Math.max(4, Math.min(100, Math.round((sub.daysLeft / data30) * 100)))}%` } })) : null,
        h('p', { class: 'muted' }, `Simultaneous screens: ${access.screens}`),
        h('div', { class: 'detail-actions' },
          h('a', { class: 'btn', href: '#/plans' }, plan ? 'Change plan' : 'See plans'),
          active && sub.status === 'active' && sub.provider !== 'admin'
            ? h('button', {
              class: 'btn danger', type: 'button',
              onClick: () => { if (confirm('Cancel your subscription? You keep access until the end of the paid period.')) act(() => api.billing.cancel(), 'Subscription canceled')(); },
            }, 'Cancel subscription') : null,
          active && sub.status === 'canceled'
            ? h('button', { class: 'btn secondary', type: 'button', onClick: act(() => api.billing.resume(), 'Subscription resumed') }, 'Resume subscription')
            : null)),
      h('section', { class: 'card-panel', 'aria-label': 'Payment history', style: { marginTop: '20px' } },
        h('h2', {}, 'Payment history'),
        payments.length
          ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Date', 'Plan', 'Amount', 'Status'].map((c) => h('th', { scope: 'col' }, c)))),
            h('tbody', {}, payments.map((p) => h('tr', {},
              h('td', {}, fmtDate(p.createdAt)),
              h('td', {}, TIER_LABEL[p.plan] ?? p.plan),
              h('td', {}, money(p.amountCents, p.currency)),
              h('td', {}, p.status + (p.provider === 'mock' ? ' (demo)' : '')))))))
          : h('p', { class: 'muted' }, 'No payments yet.')));
  }

  load();
  return h('div', { class: 'page', style: { maxWidth: '860px' } },
    h('h1', {}, 'Account'),
    h('p', { class: 'muted' }, `${state.user.username} · ${state.user.email}`),
    holder);
}
