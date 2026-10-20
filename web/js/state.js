/** Tiny global state: current user + entitlement (access). */
import { api } from './api.js';

const listeners = new Set();
export const state = { user: null, access: { level: 0, plan: null, screens: 1 } };

export const TIER_LEVEL = { free: 0, silver: 1, gold: 2, diamond: 3 };
export const TIER_LABEL = { free: 'Free', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' };

export function onUserChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUser(user, access) {
  state.user = user;
  state.access = user && access ? access : { level: 0, plan: null, screens: 1 };
  for (const fn of listeners) fn(user);
}

export async function loadUser() {
  try {
    const { user, access } = await api.me();
    setUser(user, access);
  } catch {
    setUser(null);
  }
}

export const canWatchTier = (tier) => state.access.level >= (TIER_LEVEL[tier] ?? 0);
