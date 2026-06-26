const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  // Auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me', { auth: true }),

  // Races
  listRaces: () => request('/races'),
  getRace: (id) => request(`/races/${id}`),
  getCalendar: () => request('/races/calendar'),
  listSessions: (raceId) => request(`/races/${raceId}/sessions`),
  getSessionResults: (raceId, sessionId) =>
    request(`/races/${raceId}/sessions/${encodeURIComponent(sessionId)}`),
  syncRaceByExternalId: (externalId) =>
    request(`/races/sync/${encodeURIComponent(externalId)}`, { method: 'POST', auth: true }),

  // Picks
  getMyPick: (raceId) => request(`/races/${raceId}/picks/me`, { auth: true }),
  createPick: (raceId, driverId) =>
    request(`/races/${raceId}/picks`, { method: 'POST', auth: true, body: { driverId } }),
  listPicks: () => request('/picks', { auth: true }),

  // Leaderboard
  leaderboard: () => request('/leaderboard'),
};
