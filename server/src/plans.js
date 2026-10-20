/**
 * Subscription plans and content tiers.
 *
 * Prices are PLACEHOLDERS in USD cents — edit here (and in your payment provider) before launch.
 * What is actually enforced by the server: the content tier a plan unlocks and the number of
 * simultaneous screens. Picture-quality tiers are NOT enforced (titles are single sources).
 */
export const TIERS = ['free', 'silver', 'gold', 'diamond'];
export const TIER_LEVEL = { free: 0, silver: 1, gold: 2, diamond: 3 };

export const PERIOD_DAYS = 30;
export const FREE_SCREENS = 1;

export const PLANS = [
  {
    id: 'silver',
    name: 'Silver',
    priceCents: 499,
    currency: 'USD',
    level: 1,
    screens: 1,
    tagline: 'Start watching more',
    features: ['Free catalog + all Silver titles', '1 screen at a time', 'Cancel anytime'],
  },
  {
    id: 'gold',
    name: 'Gold',
    priceCents: 899,
    currency: 'USD',
    level: 2,
    screens: 2,
    tagline: 'Best for two',
    features: ['Everything in Silver', 'All Gold titles', '2 screens at a time', 'Cancel anytime'],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    priceCents: 1299,
    currency: 'USD',
    level: 3,
    screens: 4,
    tagline: 'The whole catalog',
    features: ['Everything in Gold', 'All Diamond-exclusive titles', '4 screens at a time', 'Cancel anytime'],
  },
];

export const planById = (id) => PLANS.find((p) => p.id === id) ?? null;

export const levelForTier = (tier) => TIER_LEVEL[tier] ?? 0;

export function screensForLevel(level) {
  return PLANS.find((p) => p.level === level)?.screens ?? FREE_SCREENS;
}
