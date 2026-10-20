export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.code = data?.code ?? null; // machine-readable: login_required, upgrade_required, screen_limit, …
    this.data = data;
  }
}

async function request(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      keepalive: !!opts.keepalive,
      signal: opts.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Network error — check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/auth/me'),
  register: (b) => request('POST', '/auth/register', b),
  login: (b) => request('POST', '/auth/login', b),
  logout: () => request('POST', '/auth/logout', {}),

  home: () => request('GET', '/home'),
  genres: () => request('GET', '/genres'),
  titles: (params, opts) => request('GET', `/titles${qs(params)}`, undefined, opts),
  title: (slug, opts) => request('GET', `/titles/${encodeURIComponent(slug)}`, undefined, opts),
  rate: (id, stars) => request('PUT', `/titles/${id}/rating`, { stars }),

  watchlist: () => request('GET', '/watchlist'),
  addToWatchlist: (id) => request('PUT', `/watchlist/${id}`, {}),
  removeFromWatchlist: (id) => request('DELETE', `/watchlist/${id}`),

  plans: () => request('GET', '/plans'),
  billing: {
    subscription: () => request('GET', '/billing/subscription'),
    checkout: (plan) => request('POST', '/billing/checkout', { plan }),
    cancel: () => request('POST', '/billing/cancel', {}),
    resume: () => request('POST', '/billing/resume', {}),
  },

  // Video URLs are only handed out here, after the server checked the tier and the screen limit.
  startPlayback: (b) => request('POST', '/playback', b),
  heartbeat: (id) => request('POST', `/playback/${encodeURIComponent(id)}/heartbeat`, {}),
  stopPlayback: (id) => request('DELETE', `/playback/${encodeURIComponent(id)}`, undefined, { keepalive: true }),

  saveProgress: (b, opts) => request('PUT', '/progress', b, opts),

  admin: {
    titles: () => request('GET', '/admin/titles'),
    createTitle: (b) => request('POST', '/admin/titles', b),
    updateTitle: (id, b) => request('PUT', `/admin/titles/${id}`, b),
    deleteTitle: (id) => request('DELETE', `/admin/titles/${id}`),
    addEpisode: (id, b) => request('POST', `/admin/titles/${id}/episodes`, b),
    episodes: (id) => request('GET', `/admin/titles/${id}/episodes`),
    deleteEpisode: (id) => request('DELETE', `/admin/episodes/${id}`),
    grant: (b) => request('POST', '/admin/subscriptions', b),
    revoke: (email) => request('POST', '/admin/subscriptions/revoke', { email }),
  },
};
