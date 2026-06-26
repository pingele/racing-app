import { RaceProvider } from './RaceProvider.js';
import { config } from '../config.js';

// Race Monitor API (https://www.race-monitor.com/APIDocs).
// All endpoints: POST application/x-www-form-urlencoded, JSON response with
// { Successful: boolean, Message?: string, ... }. Base: https://api.race-monitor.com.
// Auth: apiToken in the POST body.
export class RaceMonitorProvider extends RaceProvider {
  constructor() {
    super();
    this.baseUrl = config.raceMonitorBaseUrl;
    this.token = config.raceMonitorToken;
    this.seriesCache = null; // Map<number, string>
    if (!this.token) {
      console.warn(
        '[RaceMonitorProvider] RACE_MONITOR_TOKEN is not set; live calls will fail.'
      );
    }
  }

  async #post(pathname, params = {}) {
    const url = new URL(pathname, this.baseUrl);
    const body = new URLSearchParams();
    body.set('apiToken', this.token);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, String(v));
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new Error(`Race Monitor API ${res.status}: non-JSON response`);
    }
    if (!payload?.Successful) {
      const msg = payload?.Message || `${res.status} ${res.statusText}`;
      throw new Error(`Race Monitor API ${pathname} failed: ${msg}`);
    }
    return payload;
  }

  async #loadSeries() {
    if (this.seriesCache) return this.seriesCache;
    try {
      const data = await this.#post('/v2/Account/Series');
      const map = new Map();
      for (const s of data.Series ?? []) map.set(s.ID, s.Name);
      this.seriesCache = map;
    } catch (err) {
      console.warn('[RaceMonitorProvider] series lookup failed:', err.message);
      this.seriesCache = new Map();
    }
    return this.seriesCache;
  }

  #mapRace(r, seriesMap) {
    const start = r.StartDateEpoc ? new Date(r.StartDateEpoc * 1000) : null;
    const end = r.EndDateEpoc ? new Date(r.EndDateEpoc * 1000) : null;
    const now = Date.now();
    let status = 'scheduled';
    if (r.HasResults) status = 'finished';
    else if (start && now >= start.getTime() && (!end || now <= end.getTime())) status = 'active';
    let series = r.SeriesName ?? null;
    if (!series && r.SeriesID && seriesMap?.has(r.SeriesID)) series = seriesMap.get(r.SeriesID);
    if (!series && r.AdditionalSeries?.length) series = r.AdditionalSeries[0].Name ?? null;
    return {
      external_id: String(r.ID),
      name: r.Name,
      series,
      track: r.Track ?? null,
      start_time: start ? start.toISOString() : null,
      status,
    };
  }

  async #latestSessionId(raceID) {
    const data = await this.#post('/v2/Results/SessionsForRace', { raceID });
    const sessions = data.Sessions ?? [];
    if (sessions.length === 0) return null;
    // Pick the session with the latest start; fall back to highest ID.
    sessions.sort((a, b) => {
      const ae = a.SessionStartDateEpoc ?? 0;
      const be = b.SessionStartDateEpoc ?? 0;
      if (ae !== be) return be - ae;
      return (b.ID ?? 0) - (a.ID ?? 0);
    });
    return sessions[0].ID;
  }

  async #sessionDetails(sessionID) {
    const data = await this.#post('/v2/Results/SessionDetails', { sessionID });
    return data.Session ?? null;
  }

  async #fetchCommonRaces() {
    const safe = (path, params) =>
      this.#post(path, params).catch((err) => {
        console.warn(`[RaceMonitorProvider] ${path} failed:`, err.message);
        return { Races: [] };
      });

    // The global Common/*Races feeds are short slices, not a track's full
    // schedule. To cover that we also pull every race for every series in
    // the user's Race Monitor account and merge them in (deduped by ID).
    const commonPromise = Promise.all([
      safe('/v2/Common/UpcomingRaces'),
      safe('/v2/Common/CurrentRaces'),
      safe('/v2/Common/PastRaces'),
    ]);
    const seriesMap = await this.#loadSeries();
    const seriesResponses = await Promise.all(
      [...seriesMap.keys()].map((seriesID) =>
        safe('/v2/Race/RacesForSeries', { seriesID })
      )
    );
    const [upcoming, current, past] = await commonPromise;

    const seen = new Set();
    const races = [];
    for (const r of [
      ...(upcoming.Races ?? []),
      ...(current.Races ?? []),
      ...(past.Races ?? []),
      ...seriesResponses.flatMap((s) => s.Races ?? []),
    ]) {
      if (!r || seen.has(r.ID)) continue;
      seen.add(r.ID);
      races.push(this.#mapRace(r, seriesMap));
    }
    return races;
  }

  async listRaces() {
    return this.#fetchCommonRaces();
  }

  async getCalendar() {
    return this.#fetchCommonRaces();
  }

  async getRace(externalId) {
    const raceID = Number(externalId);
    if (!Number.isFinite(raceID)) return null;
    const [data, seriesMap] = await Promise.all([
      this.#post('/v2/Race/RaceDetails', { raceID }),
      this.#loadSeries(),
    ]);
    return data.Race ? this.#mapRace(data.Race, seriesMap) : null;
  }

  async getDrivers(externalId) {
    const raceID = Number(externalId);
    if (!Number.isFinite(raceID)) return [];
    const sessionID = await this.#latestSessionId(raceID);
    if (!sessionID) return [];
    const session = await this.#sessionDetails(sessionID);
    const competitors = session?.SortedCompetitors ?? [];
    return competitors.map((c) => ({
      external_id: String(c.ID),
      number: c.Number || null,
      name: `${c.FirstName ?? ''} ${c.LastName ?? ''}`.trim() || `Competitor ${c.ID}`,
      active: true,
    }));
  }

  async getResults(externalId) {
    const raceID = Number(externalId);
    if (!Number.isFinite(raceID)) return null;
    const sessionID = await this.#latestSessionId(raceID);
    if (!sessionID) return null;
    return this.#resultsFromSession(sessionID);
  }

  async getSessions(externalId) {
    const raceID = Number(externalId);
    if (!Number.isFinite(raceID)) return [];
    try {
      const data = await this.#post('/v2/Results/GroupedSessionsForRace', { raceID });
      const out = [];
      for (const group of data.GroupedSessions ?? []) {
        for (const s of group.Sessions ?? []) {
          out.push({
            id: s.ID,
            name: s.Name || `Session ${s.ID}`,
            category: s.CategoryString || group.Category || null,
            group: group.Category || null,
            start_epoch: s.SessionStartDateEpoc ?? null,
            sort_mode: s.SortMode || null,
          });
        }
      }
      // Newest first.
      out.sort((a, b) => (b.start_epoch ?? 0) - (a.start_epoch ?? 0));
      return out;
    } catch (err) {
      console.warn('[RaceMonitorProvider] GroupedSessionsForRace failed:', err.message);
      // Fall back to flat session list.
      try {
        const data = await this.#post('/v2/Results/SessionsForRace', { raceID });
        return (data.Sessions ?? []).map((s) => ({
          id: s.ID,
          name: s.Name || `Session ${s.ID}`,
          category: null,
          group: null,
          start_epoch: s.SessionStartDateEpoc ?? null,
          sort_mode: s.SortMode || null,
        }));
      } catch {
        return [];
      }
    }
  }

  async getSessionResults(externalId, sessionId) {
    const sessionID = Number(sessionId);
    if (!Number.isFinite(sessionID)) return null;
    return this.#resultsFromSession(sessionID);
  }

  async #resultsFromSession(sessionID) {
    const session = await this.#sessionDetails(sessionID);
    const competitors = session?.SortedCompetitors ?? [];
    if (competitors.length === 0) return null;
    const results = [];
    for (const c of competitors) {
      const pos = parseInt(c.Position, 10);
      const laps = parseInt(c.Laps, 10);
      const base = {
        driver_external_id: String(c.ID),
        number: c.Number || null,
        name: `${c.FirstName ?? ''} ${c.LastName ?? ''}`.trim() || `Competitor ${c.ID}`,
        laps: Number.isFinite(laps) ? laps : null,
        best_lap_time: c.BestLapTime || null,
        last_lap_time: c.LastLapTime || null,
        total_time: c.TotalTime || null,
      };
      if (Number.isFinite(pos) && pos > 0) {
        results.push({ ...base, finish_position: pos, status: 'Classified' });
      } else {
        results.push({ ...base, finish_position: 0, status: c.Position || 'DNF' });
      }
    }
    return results;
  }
}
