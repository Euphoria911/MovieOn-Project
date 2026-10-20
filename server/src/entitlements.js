import { TIER_LEVEL, PLANS, screensForLevel } from './plans.js';

/** The user's subscription row if it still grants access (active, or canceled but not yet expired). */
export function activeSubscription(db, userId, now = Date.now()) {
  if (!userId) return null;
  const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (!row) return null;
  return new Date(row.current_period_end).getTime() > now ? row : null;
}

/** 0 = free/anonymous … 3 = diamond. Admins are treated as Diamond so they can QA every title. */
export function userLevel(db, user, now = Date.now()) {
  if (!user) return 0;
  if (user.role === 'admin') return TIER_LEVEL.diamond;
  const sub = activeSubscription(db, user.id, now);
  return sub ? TIER_LEVEL[sub.plan] : 0;
}

export function accessFor(db, user, now = Date.now()) {
  const level = userLevel(db, user, now);
  const sub = user ? activeSubscription(db, user.id, now) : null;
  return {
    level,
    plan: sub?.plan ?? null,
    screens: screensForLevel(level),
    subscription: sub ? serializeSubscription(sub, now) : null,
  };
}

export function serializeSubscription(row, now = Date.now()) {
  const end = new Date(row.current_period_end).getTime();
  return {
    plan: row.plan,
    status: row.status, // 'active' | 'canceled' (canceled = no renewal, access until period end)
    currentPeriodEnd: row.current_period_end,
    daysLeft: Math.max(0, Math.ceil((end - now) / 86_400_000)),
    provider: row.provider,
    active: end > now,
  };
}

export const canWatch = (level, minTier) => level >= (TIER_LEVEL[minTier] ?? 0);

export const planName = (id) => PLANS.find((p) => p.id === id)?.name ?? id;
