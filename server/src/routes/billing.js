import { Router } from 'express';
import crypto from 'node:crypto';
import { HttpError, oneOf } from '../util.js';
import { PERIOD_DAYS, PLANS, planById } from '../plans.js';
import { accessFor, activeSubscription, serializeSubscription } from '../entitlements.js';

const DAY = 86_400_000;

/**
 * Billing.
 *
 * Only the "mock" provider is implemented: it records a successful payment instantly and collects
 * NO card data. It exists to demo and test the subscription flow. For real money, implement a
 * provider that redirects to a hosted checkout and activates subscriptions from a signed webhook
 * (see docs/04-deployment-and-operations.md §12). Without BILLING_PROVIDER, checkout is disabled.
 */
export function billingRoutes(db, auth, { provider = 'none' } = {}) {
  const r = Router();
  const enabled = provider === 'mock';

  r.get('/plans', (_req, res) => {
    res.json({ plans: PLANS, checkoutEnabled: enabled, provider, periodDays: PERIOD_DAYS });
  });

  r.use('/billing', auth.requireAuth);

  r.get('/billing/subscription', (req, res) => {
    const access = accessFor(db, req.user);
    const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
    const payments = db
      .prepare(
        `SELECT id, plan, amount_cents AS amountCents, currency, status, provider, created_at AS createdAt
         FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
      )
      .all(req.user.id);
    res.json({
      subscription: row ? serializeSubscription(row) : null, // includes expired rows (active:false)
      access: { level: access.level, plan: access.plan, screens: access.screens },
      payments,
    });
  });

  r.post('/billing/checkout', (req, res) => {
    if (!enabled) {
      throw new HttpError(503, 'Payments are not configured on this server.', { code: 'billing_disabled' });
    }
    const planId = oneOf(req.body?.plan, 'plan', PLANS.map((p) => p.id), { required: true });
    const plan = planById(planId);
    const now = Date.now();
    const current = activeSubscription(db, req.user.id, now);
    if (current && current.plan === planId && current.status === 'active') {
      throw new HttpError(409, `You are already subscribed to ${plan.name}.`, { code: 'already_subscribed' });
    }
    const ref = `mock_${crypto.randomBytes(8).toString('hex')}`;
    const start = new Date(now).toISOString();
    const end = new Date(now + PERIOD_DAYS * DAY).toISOString();

    db.exec('BEGIN');
    try {
      // Plan change = new period starting now at full price (no proration — documented limitation).
      db.prepare(
        `INSERT INTO subscriptions (user_id, plan, status, started_at, current_period_end, provider, provider_ref)
         VALUES (?, ?, 'active', ?, ?, 'mock', ?)
         ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active',
           started_at = excluded.started_at, current_period_end = excluded.current_period_end,
           provider = excluded.provider, provider_ref = excluded.provider_ref`,
      ).run(req.user.id, planId, start, end, ref);
      db.prepare(
        `INSERT INTO payments (user_id, plan, amount_cents, currency, status, provider, provider_ref, created_at)
         VALUES (?, ?, ?, ?, 'succeeded', 'mock', ?, ?)`,
      ).run(req.user.id, planId, plan.priceCents, plan.currency, ref, start);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
    res.status(201).json({ subscription: serializeSubscription(row), access: accessFor(db, req.user) });
  });

  r.post('/billing/cancel', (req, res) => {
    const sub = activeSubscription(db, req.user.id);
    if (!sub) throw new HttpError(404, 'No active subscription to cancel.');
    db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ?").run(req.user.id);
    const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
    res.json({ subscription: serializeSubscription(row) });
  });

  r.post('/billing/resume', (req, res) => {
    const sub = activeSubscription(db, req.user.id);
    if (!sub || sub.status !== 'canceled') {
      throw new HttpError(409, 'There is no canceled subscription to resume.');
    }
    db.prepare("UPDATE subscriptions SET status = 'active' WHERE user_id = ?").run(req.user.id);
    const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
    res.json({ subscription: serializeSubscription(row) });
  });

  return r;
}
