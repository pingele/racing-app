// Thin wrapper over AWS Amplify Data (AppSync + DynamoDB) for the MyRacePass
// scraper + finish-order prediction game.
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';

const client = generateClient({ authMode: 'userPool' });

// Page through an index/list query until exhausted.
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

function bySort(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

// Custom mutations declared with `.returns(a.json())` come back from AppSync as
// a JSON string. Parse it so callers get the actual object (counts, ids, etc.).
function parseJsonResult(data) {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

// F1-style default points table — mirrors DEFAULT_SCORING_RULES in the
// scrape-race Lambda. Used as a fallback when no ScoringRule rows exist yet.
const DEFAULT_SCORING_RULES = {
  1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
};

// finishPosition -> points, as an object. Falls back to the F1 default table.
async function fetchScoringRules() {
  const rules = await listAll(client.models.ScoringRule.list);
  if (!rules.length) return { ...DEFAULT_SCORING_RULES };
  const map = {};
  for (const r of rules) map[Number(r.finishPosition)] = Number(r.points);
  return map;
}

export const api = {
  // ---- profile / user storage ----------------------------------------------
  async upsertProfile(user) {
    const existing = await listAll(client.models.UserProfile.listUserProfileByUserId, {
      userId: user.id,
    });
    const fields = {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.isAdmin ? 'admin' : 'user',
    };
    if (existing[0]) {
      await client.models.UserProfile.update({ id: existing[0].id, ...fields });
    } else {
      await client.models.UserProfile.create(fields);
    }
  },

  // ---- users (admin) --------------------------------------------------------
  // Every signed-in user has a UserProfile row (created lazily on first login),
  // so this lists everyone who has logged in. Sorted by display name / email.
  async listUserProfiles() {
    const profiles = await listAll(client.models.UserProfile.list);
    return profiles.sort((a, b) =>
      (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''),
    );
  },

  // Grant or revoke admin access for a user (by their Cognito sub / userId).
  // Backed by the manage-admin Lambda, which edits the `Admins` group and syncs
  // the UserProfile.role mirror.
  async setAdminRole(userId, makeAdmin) {
    const { data, errors } = await client.mutations.setAdminRole({ userId, makeAdmin });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  // ---- races ----------------------------------------------------------------
  // By default hidden races are filtered out (the public Races screen). Admin
  // passes { includeHidden: true } so admins still see every race.
  async listRaces({ includeHidden = false } = {}) {
    const races = await listAll(client.models.Race.list);
    const visible = includeHidden ? races : races.filter((r) => !r.hidden);
    visible.sort((a, b) => (b.eventDate ?? '').localeCompare(a.eventDate ?? ''));
    return visible;
  },

  async getRace(id) {
    const { userId } = await getCurrentUser();
    const { data: race } = await client.models.Race.get({ id });
    if (!race) throw Object.assign(new Error('Race not found'), { status: 404 });

    const [classes, predictions, scoringRules] = await Promise.all([
      listAll(client.models.RaceClass.listRaceClassByRaceId, { raceId: id }),
      listAll(client.models.Prediction.listPredictionByRaceId, { raceId: id }),
      fetchScoringRules(),
    ]);
    classes.sort(bySort);

    const detailed = await Promise.all(
      classes.map(async (cls) => {
        const [entries, results] = await Promise.all([
          listAll(client.models.Entry.listEntryByClassId, { classId: cls.id }),
          listAll(client.models.RaceResult.listRaceResultByClassId, { classId: cls.id }),
        ]);
        entries.sort(bySort);
        // Finishers in order; DNS/DNF (finishPosition <= 0) sort to the bottom.
        const finPos = (r) => (r.finishPosition > 0 ? r.finishPosition : Infinity);
        results.sort((a, b) => finPos(a) - finPos(b));
        const classPredictions = predictions.filter((p) => p.classId === cls.id);
        const myPrediction =
          classPredictions.find((p) => p.userId === userId) ?? null;
        // Distinct users who saved a prediction in this class.
        const predictionCount = new Set(classPredictions.map((p) => p.userId)).size;
        return { ...cls, entries, results, myPrediction, predictionCount };
      }),
    );

    // Distinct users with at least one saved prediction anywhere in this race.
    const predictionUserCount = new Set(predictions.map((p) => p.userId)).size;

    return { race, classes: detailed, scoringRules, predictionUserCount };
  },

  async savePrediction(raceId, classId, orderedEntryIds) {
    const { userId } = await getCurrentUser();
    const attrs = await fetchUserAttributes();
    const displayName = attrs.nickname || attrs.email;
    const existing = await listAll(client.models.Prediction.listPredictionByClassId, {
      classId,
    });
    const mine = existing.find((p) => p.userId === userId);
    if (mine) {
      const { data, errors } = await client.models.Prediction.update({
        id: mine.id,
        orderedEntryIds,
        displayName,
      });
      if (errors?.length) throw new Error(errors[0].message);
      return data;
    }
    const { data, errors } = await client.models.Prediction.create({
      raceId,
      classId,
      userId,
      displayName,
      orderedEntryIds,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return data;
  },

  // ---- admin ----------------------------------------------------------------
  async setLock(raceId, locked) {
    const { data, errors } = await client.models.Race.update({
      id: raceId,
      predictionsLocked: locked,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return data;
  },

  async setHidden(raceId, hidden) {
    const { data, errors } = await client.models.Race.update({
      id: raceId,
      hidden,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return data;
  },

  // Lock/unlock predictions for a single class (independent of the race-level
  // Race.predictionsLocked master switch). Admins have group write on RaceClass.
  async setClassLock(classId, locked) {
    const { data, errors } = await client.models.RaceClass.update({
      id: classId,
      locked,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return data;
  },

  async importRaceDetails(eventId) {
    const { data, errors } = await client.mutations.importRaceDetails({ eventId });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  async importRaceClasses(eventId) {
    const { data, errors } = await client.mutations.importRaceClasses({ eventId });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  async importRaceEntries(eventId) {
    const { data, errors } = await client.mutations.importRaceEntries({ eventId });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  async importRaceResults(eventId) {
    const { data, errors } = await client.mutations.importRaceResults({ eventId });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  // Delete predictions + scores. Pass a raceId to clear just that race, or omit
  // it to clear every race (a full-season reset). Users/logins are kept.
  async clearPredictions(raceId) {
    const { data, errors } = await client.mutations.clearPredictions(
      raceId ? { raceId } : {},
    );
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  // Reset a race's results: delete the entered results and clear every score
  // for the race, keeping users' predictions intact. Backed by the scrape-race
  // Lambda (predictions are owner-authed, so the browser can't clear others').
  async resetRaceResults(raceId) {
    const { data, errors } = await client.mutations.resetRaceResults({ raceId });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  // Save admin-entered finishing results and score predictions. `results` is an
  // array of { classId, rows: [{ entryId, status }] } in finish order (status is
  // null for a finisher, or 'DNF'/'DNS'/'DQ'). Backed by the scrape-race Lambda,
  // which owns the write + scoring (predictions are owner-authed, so the browser
  // can't score other users' rows).
  async enterRaceResults(raceId, results) {
    const { data, errors } = await client.mutations.enterRaceResults({
      raceId,
      results: JSON.stringify(results),
    });
    if (errors?.length) throw new Error(errors[0].message);
    return parseJsonResult(data);
  },

  // ---- scoring --------------------------------------------------------------
  // The active points table (finishPosition -> points), sorted by position.
  // Falls back to the F1 default table when no ScoringRule rows exist yet.
  async scoringRules() {
    const map = await fetchScoringRules();
    return Object.entries(map)
      .map(([finishPosition, points]) => ({
        finishPosition: Number(finishPosition),
        points: Number(points),
      }))
      .sort((a, b) => a.finishPosition - b.finishPosition);
  },

  // ---- standings ------------------------------------------------------------
  // Aggregate every prediction into per-event scores + running totals. Each
  // prediction snapshots the user's displayName, so no admin pool access needed.
  async standings() {
    const [predictions, races] = await Promise.all([
      listAll(client.models.Prediction.list),
      listAll(client.models.Race.list),
    ]);
    const raceName = new Map(races.map((r) => [r.id, r.name]));
    return { standings: aggregateStandings(predictions, raceName) };
  },

  // Live standings for the leaderboard rail. Subscribes to the Prediction model
  // via observeQuery, so the leaderboard reflects scored races the moment the
  // scorer's mutation lands and (via the `authenticated` read rule's listen
  // access) as other users' predictions are scored. `onData` receives the full
  // ranked standings array; per-event breakdowns are omitted (race names aren't
  // needed for the rail). Returns an unsubscribe function.
  subscribeStandings(onData, onError) {
    const sub = client.models.Prediction.observeQuery().subscribe({
      next: ({ items }) => onData(aggregateStandings(items)),
      error: (err) => onError?.(err),
    });
    return () => sub.unsubscribe();
  },
};

// Roll predictions up into ranked standings rows. Pass a raceId -> name map to
// include the per-event points breakdown (used by the full Standings page);
// omit it for the lightweight leaderboard, which only needs rank/name/points.
function aggregateStandings(predictions, raceName = null) {
  const byUser = new Map();
  for (const p of predictions) {
    if (!p.userId) continue;
    const u = byUser.get(p.userId) ?? {
      userId: p.userId,
      displayName: p.displayName || 'Racer',
      totalPoints: 0,
      predictionsMade: 0,
      predictionsScored: 0,
      byRace: new Map(),
    };
    u.predictionsMade += 1;
    if (p.scoredAt) u.predictionsScored += 1;
    const pts = p.pointsAwarded ?? 0;
    u.totalPoints += pts;
    u.byRace.set(p.raceId, (u.byRace.get(p.raceId) ?? 0) + pts);
    if (p.displayName) u.displayName = p.displayName;
    byUser.set(p.userId, u);
  }

  return [...byUser.values()]
    .map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      totalPoints: u.totalPoints,
      predictionsMade: u.predictionsMade,
      predictionsScored: u.predictionsScored,
      events: raceName
        ? [...u.byRace.entries()]
            .map(([raceId, points]) => ({
              raceId,
              name: raceName.get(raceId) ?? 'Race',
              points,
            }))
            .sort((a, b) => b.points - a.points)
        : [],
    }))
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((u, i) => ({ rank: i + 1, ...u }));
}
