import { h } from '../dom.js';
import { api } from '../api.js';
import { state, setUser, TIER_LABEL } from '../state.js';
import { link, navigate } from '../router.js';
import { toast, errorPanel, emptyPanel, tierBadge, celebrate } from '../ui.js';
import { icon, TIER_ICON } from '../icons.js';

export const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

const FREE_FEATURES = ['The free catalog', '1 screen at a time', 'No card needed'];

const features = (list) => h('ul', { class: 'plan-features' },
  list.map((f, j) => h('li', { vars: { '--j': j } }, icon('check', { size: 16 }), h('span', {}, f))));

function planCard(p, { current, checkoutEnabled, i = 0 }) {
  const isCurrent = current === p.id;
  const loggedIn = !!state.user;
  const href = loggedIn ? link(`/checkout/${p.id}`) : link('/login', { next: `/checkout/${p.id}` });
  const label = isCurrent ? 'Your current plan'
    : state.access.level > p.level ? `Switch to ${p.name}`
      : state.access.level > 0 ? `Upgrade to ${p.name}` : `Choose ${p.name}`;
  return h('article', { class: `plan plan-${p.id} enter ${isCurrent ? 'current' : ''}`, vars: { '--i': i }, 'aria-label': `${p.name} plan` },
    h('div', { class: 'plan-emblem', 'aria-hidden': 'true' }, icon(TIER_ICON[p.id] ?? 'play', { size: 30 })),
    tierBadge(p.id),
    h('p', { class: 'plan-tag' }, p.tagline),
    h('p', { class: 'plan-price' }, h('b', {}, money(p.priceCents, p.currency)), h('span', { class: 'muted' }, ' / month')),
    features(p.features),
    isCurrent
      ? h('span', { class: 'btn secondary', 'aria-disabled': 'true' }, label)
      : h('a', { class: 'btn', href, 'aria-disabled': checkoutEnabled ? null : 'true' }, label));
}

export async function plansPage(ctx) {
  ctx.title('Plans — MovieOn');
  ctx.mount(h('div', { class: 'page' }, h('h1', {}, 'Choose your plan')));
  let data;
  try {
    data = await api.plans();
  } catch (e) {
    return h('div', { class: 'page' }, h('h1', {}, 'Choose your plan'), errorPanel(e.message, () => navigate(location.hash)));
  }
  return h('div', { class: 'page' },
    h('header', { class: 'plans-head' },
      h('h1', {}, 'Choose your plan'),
      h('p', { class: 'muted' }, 'Watch the free catalog at no cost, or unlock more titles and more simultaneous screens. Cancel anytime — access continues until the end of the period you paid for.')),
    data.checkoutEnabled ? null : h('p', { class: 'notice', role: 'status' },
      'Online payments are not enabled on this server yet, so plans cannot be purchased here. An administrator can still assign a plan to your account.'),
    data.provider === 'mock' ? h('p', { class: 'notice', role: 'status' },
      'Demo mode: checkout is simulated. No card details are collected and nobody is charged.') : null,
    h('div', { class: 'plans' },
      h('article', { class: `plan plan-free enter ${state.access.level === 0 ? 'current' : ''}`, vars: { '--i': 0 }, 'aria-label': 'Free plan' },
        h('div', { class: 'plan-emblem', 'aria-hidden': 'true' }, icon('play', { size: 30 })),
        tierBadge('free'),
        h('p', { class: 'plan-tag' }, 'Just press play'),
        h('p', { class: 'plan-price' }, h('b', {}, money(0)), h('span', { class: 'muted' }, ' / month')),
        features(FREE_FEATURES),
        h('a', { class: 'btn ghost', href: link('/browse', { tier: 'free' }) }, 'Browse free titles')),
      data.plans.map((p, i) => planCard(p, { current: state.access.plan, checkoutEnabled: data.checkoutEnabled, i: i + 1 }))),
    h('p', { class: 'muted fine-print' }, 'Prices shown are placeholders and billed in USD. A plan unlocks titles marked with its tier and every lower tier.'));
}

export async function checkoutPage(ctx) {
  const planId = ctx.params.plan;
  ctx.title('Checkout — MovieOn');
  if (!state.user) {
    navigate(link('/login', { next: `/checkout/${planId}` }));
    return;
  }
  let data;
  try {
    data = await api.plans();
  } catch (e) {
    return h('div', { class: 'page' }, errorPanel(e.message, () => navigate(location.hash)));
  }
  const plan = data.plans.find((p) => p.id === planId);
  if (!plan) {
    return h('div', { class: 'page' }, emptyPanel('Unknown plan', 'Pick one of the available plans.'),
      h('p', { style: { textAlign: 'center' } }, h('a', { class: 'btn', href: '#/plans' }, 'See plans')));
  }

  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button', style: { width: '100%' }, disabled: !data.checkoutEnabled },
    icon('lock', { size: 16 }), `Confirm and pay ${money(plan.priceCents, plan.currency)}`);
  btn.addEventListener('click', async () => {
    err.textContent = '';
    btn.disabled = true;
    try {
      const r = await api.billing.checkout(plan.id);
      setUser(state.user, r.access);
      await celebrate(`${plan.name} is active`, plan.id);
      toast(`${plan.name} is active. Enjoy!`);
      navigate('#/account');
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = e.code === 'already_subscribed' ? true : false;
    }
  });

  return h('div', { class: 'page-narrow' },
    h('div', { class: 'card-panel' },
      h('h1', {}, 'Confirm your plan'),
      h('div', { class: 'summary' },
        tierBadge(plan.id),
        h('p', { class: 'plan-price' }, h('b', {}, money(plan.priceCents, plan.currency)), h('span', { class: 'muted' }, ` / ${data.periodDays} days`)),
        features(plan.features)),
      state.access.plan && state.access.plan !== plan.id
        ? h('p', { class: 'muted' }, `This replaces your current ${TIER_LABEL[state.access.plan]} plan. A new ${data.periodDays}-day period starts now at the full price; there is no proration.`)
        : null,
      data.checkoutEnabled
        ? h('p', { class: 'notice' }, 'Demo checkout: no card details are collected and nobody is charged. The subscription does not renew automatically.')
        : h('p', { class: 'notice', role: 'status' }, 'Online payments are not enabled on this server, so this plan cannot be purchased here.'),
      err, btn,
      h('p', { style: { marginTop: '14px', marginBottom: 0, textAlign: 'center' } }, h('a', { href: '#/plans', class: 'muted', style: { textDecoration: 'underline' } }, 'Back to plans'))));
}
