// Thin adapter over AWS Amplify Data (AppSync + DynamoDB) that preserves the
// snake_case response shape the legacy REST API used, so existing pages can
// keep consuming `api.listRaces()`, `api.getRace(id)`, etc. with no changes.
import { generateClient } from 'aws-amplify/data';
import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';

const client = generateClient({ authMode: 'userPool' });

// ---- helpers ----------------------------------------------------------------

function raceToWire(r) {
  return {
    id: r.id,
    external_id: r.externalId,
    name: r.name,
    series: r.series ?? null,
    track: r.track ?? null,
    start_time: r.startTime ?? null,
    status: r.status ?? 'scheduled',
  };
}

function driverToWire(d) {
  return {
    id: d.id,
    race_id: d.raceId,
    external_id: d.externalId,
    number: d.number ?? null,
    name: d.name,
    active: d.active ? 1 : 0,
  };
}

function resultToWire(r, driverById) {
  const d = driverById.get(r.driverId);
  return {
    driver_id: r.driverId,
    name: d?.name ?? '',
    number: d?.number ?? '',
    finish_position: r.finishPosition,
    status: r.status ?? null,
    laps: r.laps ?? null,
    best_lap_time: r.bestLapTime ?? null,
    last_lap_time: r.lastLapTime ?? null,
    total_time: r.totalTime ?? null,
  };
}

async function listAll(modelFn, args = {}) {
  const out = [];
  let nextToken = null;
  do {
    const { data, nextToken: nt } = await modelFn({ ...args, nextToken });
    if (data) out.push(...data);
    nextToken = nt;
  } while (nextToken);
  return out;
}

// Monday 00:00 local through next Monday 00:00 local — matches legacy
// `currentWeekRange` in raceController.js.
function currentWeekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = start.getDay();
  const daysSinceMonday = (dow + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ---- api surface ------------------------------------------------------------

export const api = {
  // Auth — kept as a thin shim for any caller that still imports `api.me`.
  // The AuthContext now uses Amplify Auth directly.
  async me() {
    const { userId } = await getCurrentUser();
    const attrs = await fetchUserAttributes();
    return {
      user: {
        id: userId,
        email: attrs.email,
        displayName: attrs.nickname || attrs.email,
      },
    };
  },

  // Races -------------------------------------------------------------------
  async listRaces() {
    const all = await listAll(client.models.Race.list);
    const { start, end } = currentWeekRange();
    const races = all
      .filter((r) => r.startTime && r.startTime >= start && r.startTime < end)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
      .map(raceToWire);
    return { races };
  },

  async getRace(id) {
    const { data: race } = await client.models.Race.get({ id });
    if (!race) throw Object.assign(new Error('Race not found'), { status: 404 });

    const drivers = await listAll(client.models.Driver.listDriverByRaceId, {
      raceId: id,
    });
    drivers.sort(
      (a, b) =>
        (parseInt(a.number ?? '0', 10) || 0) -
        (parseInt(b.number ?? '0', 10) || 0),
    );
    const driverById = new Map(drivers.map((d) => [d.id, d]));

    let results = [];
    if (race.status === 'finished') {
      const rs = await listAll(client.models.RaceResult.listRaceResultByRaceId, {
        raceId: id,
      });
      results = rs
        .sort((a, b) => a.finishPosition - b.finishPosition)
        .map((r) => resultToWire(r, driverById));
    }

    return {
      race: raceToWire(race),
      drivers: drivers.map(driverToWire),
      results,
    };
  },

  async getCalendar() {
    const all = await listAll(client.models.Race.list);
    const races = all
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
      .map(raceToWire);
    return { races };
  },

  // Race-Monitor live-session features aren't exposed by AppSync; degrade
  // gracefully so the UI hides the session picker and shows synced results.
  async listSessions() {
    return { sessions: [] };
  },
  async getSessionResults() {
    return { results: [] };
  },

  // No-op: provider sync runs on the schedule defined by the `sync-races`
  // Lambda. Returns the matching race so callers can keep working.
  async syncRaceByExternalId(externalId) {
    const { data } = await client.models.Race.listRaceByExternalId({ externalId });
    return { race: data?.[0] ? raceToWire(data[0]) : null };
  },

  // Picks -------------------------------------------------------------------
  async getMyPick(raceId) {
    const { userId } = await getCurrentUser();
    const all = await listAll(client.models.Pick.listPickByRaceId, { raceId });
    const mine = all.find((p) => p.owner === userId || p.owner?.endsWith(userId));
    if (!mine) return { pick: null };
    return {
      pick: {
        id: mine.id,
        race_id: mine.raceId,
        driver_id: mine.driverId,
        points_awarded: mine.pointsAwarded ?? null,
        scored_at: mine.scoredAt ?? null,
      },
    };
  },

  async createPick(raceId, driverId) {
    const attrs = await fetchUserAttributes();
    const { data, errors } = await client.models.Pick.create({
      raceId,
      driverId,
      displayName: attrs.nickname || attrs.email,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return {
      pick: { id: data.id, raceId: data.raceId, driverId: data.driverId },
    };
  },

  async listPicks() {
    const { userId } = await getCurrentUser();
    const picks = await listAll(client.models.Pick.list);
    const mine = picks.filter(
      (p) => p.owner === userId || p.owner?.endsWith(userId),
    );

    // Resolve race + driver names in parallel (small N — one row per pick).
    const rows = await Promise.all(
      mine.map(async (p) => {
        const [{ data: race }, { data: driver }, results] = await Promise.all([
          client.models.Race.get({ id: p.raceId }),
          client.models.Driver.get({ id: p.driverId }),
          listAll(client.models.RaceResult.listRaceResultByRaceId, {
            raceId: p.raceId,
          }),
        ]);
        const myResult = results.find((r) => r.driverId === p.driverId);
        return {
          id: p.id,
          race_id: p.raceId,
          driver_id: p.driverId,
          created_at: p.createdAt,
          points_awarded: p.pointsAwarded ?? null,
          scored_at: p.scoredAt ?? null,
          race_name: race?.name ?? '',
          race_status: race?.status ?? 'scheduled',
          start_time: race?.startTime ?? null,
          driver_name: driver?.name ?? '',
          driver_number: driver?.number ?? '',
          finish_position: myResult?.finishPosition ?? null,
        };
      }),
    );
    rows.sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''));
    return { picks: rows };
  },

  // Leaderboard ------------------------------------------------------------
  // Aggregates picks client-side. With Cognito-backed Pick rows, each pick
  // carries the user's `owner` (Cognito sub) and a snapshot of `displayName`,
  // so we don't need admin access to the Cognito user pool to render this.
  async leaderboard() {
    const picks = await listAll(client.models.Pick.list);
    const byOwner = new Map();
    for (const p of picks) {
      const key = p.owner;
      if (!key) continue;
      const entry = byOwner.get(key) ?? {
        user_id: key,
        display_name: p.displayName || 'Racer',
        total_points: 0,
        picks_made: 0,
        picks_scored: 0,
      };
      entry.picks_made += 1;
      if (p.scoredAt) entry.picks_scored += 1;
      entry.total_points += p.pointsAwarded ?? 0;
      // Latest displayName wins (in case user updated their nickname).
      if (p.displayName) entry.display_name = p.displayName;
      byOwner.set(key, entry);
    }
    const ranked = [...byOwner.values()]
      .sort((a, b) => {
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;
        if (b.picks_scored !== a.picks_scored) return b.picks_scored - a.picks_scored;
        return a.display_name.localeCompare(b.display_name);
      })
      .map((row, i) => ({ rank: i + 1, ...row }));
    return { leaderboard: ranked };
  },
};
