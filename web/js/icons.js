/**
 * MovieOn icon set — original 24×24 line/solid icons drawn for this project.
 * Replaces emoji and text glyphs (▶ ✓ ★ 🔒 …) so rendering is identical on every platform,
 * inherits the text colour (currentColor) and can be animated with CSS.
 * Icons are decorative (aria-hidden): the surrounding text carries the accessible name.
 */
import { h } from './dom.js';

const S = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const SOLID = { fill: 'currentColor', stroke: 'none' };

const p = (d, extra = {}) => h('path', { d, ...extra });

const ICONS = {
  play: () => [p('M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z', SOLID)],
  lock: () => [
    h('rect', { x: 5, y: 11, width: 14, height: 9.5, rx: 2.6, class: 'ic-body' }),
    p('M8.2 11V8.2a3.8 3.8 0 0 1 7.6 0V11', { class: 'ic-shackle' }),
    h('circle', { cx: 12, cy: 15.6, r: 1.25, ...SOLID }),
  ],
  check: () => [p('M5 12.8l4.6 4.5L19 7.6', { class: 'ic-check', pathLength: 1 })],
  plus: () => [p('M12 5v14M5 12h14')],
  close: () => [p('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  chevL: () => [p('M14.5 6l-6 6 6 6')],
  chevR: () => [p('M9.5 6l6 6-6 6')],
  arrowL: () => [p('M19 12H5.5M11 6l-6 6 6 6')],
  arrowR: () => [p('M5 12h13.5M13 6l6 6-6 6')],
  star: () => [p('M12 3.6l2.55 5.35 5.85.8-4.3 4.1 1.08 5.85L12 16.9l-5.18 2.8 1.08-5.85-4.3-4.1 5.85-.8z', { ...S, fill: 'currentColor' })],
  search: () => [h('circle', { cx: 11, cy: 11, r: 6.6 }), p('M16 16l4.6 4.6')],
  shield: () => [p('M12 3.2l7 2.9v5.4c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6.1z'), p('M9 12.2l2.2 2.2 3.9-4.2')],
  crown: () => [p('M3.8 8.2l4.3 3.8L12 5.4l3.9 6.6 4.3-3.8-1.7 10.2H5.5z'), p('M6 20.2h12')],
  gem: () => [p('M7.2 4.2h9.6l4 4.8L12 20 3.2 9z'), p('M3.2 9h17.6M9.6 4.2L8 9l4 11 4-11-1.6-4.8')],
  monitor: () => [h('rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 2.2 }), p('M8.8 20h6.4M12 16.5V20')],
  info: () => [h('circle', { cx: 12, cy: 12, r: 9 }), p('M12 11v5.2'), h('circle', { cx: 12, cy: 7.9, r: 1.1, ...SOLID })],
  alert: () => [p('M12 4.2l9 15.6H3z'), p('M12 10v4.2'), h('circle', { cx: 12, cy: 16.9, r: 1, ...SOLID })],
  sparkle: () => [p('M12 3l1.9 5.3L19.2 10l-5.3 1.8L12 17.2l-1.9-5.4L4.8 10l5.3-1.7z', { ...S, fill: 'currentColor' }), p('M19 16.2v3.6M17.2 18h3.6')],
  retry: () => [p('M20 12a8 8 0 1 1-2.5-5.8'), p('M20.2 4.2v4.6h-4.6')],
  film: () => [h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.4 }), p('M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5')],
  user: () => [h('circle', { cx: 12, cy: 8.2, r: 3.6 }), p('M4.8 20c.6-3.7 3.4-5.8 7.2-5.8s6.6 2.1 7.2 5.8')],
};

/** icon('lock', { size: 18, class: 'x' }) → <svg> element */
export function icon(name, { size = 20, class: cls = '' } = {}) {
  const make = ICONS[name];
  if (!make) throw new Error(`Unknown icon: ${name}`);
  const solid = name === 'play';
  return h('svg', {
    class: `icon icon-${name} ${cls}`.trim(), viewBox: '0 0 24 24', width: size, height: size,
    'aria-hidden': 'true', focusable: 'false', ...(solid ? {} : S),
  }, make());
}

/** Icon for a content tier (Free has none). */
export const TIER_ICON = { silver: 'shield', gold: 'crown', diamond: 'gem' };

/** Equaliser bars — "now playing" marker in episode lists. */
export function equalizer() {
  return h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {}));
}

/** Ring + play glyph used while a stream is loading. */
export function spinner() {
  return h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading video' },
    h('svg', { viewBox: '0 0 64 64', width: 64, height: 64, 'aria-hidden': 'true', fill: 'none' },
      h('circle', { class: 'sp-track', cx: 32, cy: 32, r: 27, 'stroke-width': 4 }),
      h('circle', { class: 'sp-arc', cx: 32, cy: 32, r: 27, 'stroke-width': 4, 'stroke-linecap': 'round' }),
      h('path', { class: 'sp-play', d: 'M27 22.5v19a1 1 0 0 0 1.5.85l15.2-9.5a1 1 0 0 0 0-1.7l-15.2-9.5a1 1 0 0 0-1.5.85z', fill: 'currentColor' })));
}
