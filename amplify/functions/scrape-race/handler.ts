import type { AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/scrape-race';
import type { Schema } from '../../data/resource.js';
import {
  parseEventDetails,
  parseSessions,
  parseResults,
} from './myracepass.js';

// Class names differ in case between the details page (title case) and the
// races page (title case) etc., so classes are always matched case-insensitively.
const sameName = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * On-demand scrape Lambda. Backs the `importRaceDetails` and `importRaceResults`
 * custom mutations; branches on `event.fieldName`. Fetches MyRacePass pages,
 * parses them, upserts into DynamoDB via the Amplify Data client, and (on
 * results import) scores predictions F1-style.
 */

type Args = { eventId: string };

const DEFAULT_SCORING_RULES = [
  { finishPosition: 1, points: 25 },
  { finishPosition: 2, points: 18 },
  { finishPosition: 3, points: 15 },
  { finishPosition: 4, points: 12 },
  { finishPosition: 5, points: 10 },
  { finishPosition: 6, points: 8 },
  { finishPosition: 7, points: 6 },
  { finishPosition: 8, points: 4 },
  { finishPosition: 9, points: 2 },
  { finishPosition: 10, points: 1 },
];

const BASE = env.MRP_BASE_URL || 'https://www.myracepass.com';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`MyRacePass ${url} returned ${res.status}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// MyRacePass intermittently serves datacenter IPs a partial page (parses to
// nothing). Re-fetch a few times until the parser yields content.
async function fetchParsed<T>(
  url: string,
  parse: (html: string) => T[],
  attempts = 4,
): Promise<T[]> {
  let parsed: T[] = [];
  for (let i = 0; i < attempts; i++) {
    const html = await fetchHtml(url);
    parsed = parse(html);
    if (parsed.length) return parsed;
    if (i < attempts - 1) await sleep(700 * (i + 1));
  }
  console.warn(`[scrape] ${url} parsed empty after ${attempts} attempts`);
  return parsed;
}

async function listAll(
  modelFn: (args: any) => Promise<any>,
  args: Record<string, unknown> = {},
): Promise<any[]> {
  const out: any[] = [];
  let nextToken: string | null | undefined = null;
  do {
    const { data, nextToken: nt } = await modelFn({ ...args, nextToken });
    if (data) out.push(...data);
    nextToken = nt ?? null;
  } while (nextToken);
  return out;
}

function makeClient() {
  return generateClient<Schema>();
}
type DataClient = ReturnType<typeof makeClient>;

let _client: DataClient | null = null;
async function getClient(): Promise<DataClient> {
  if (_client) return _client;
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  _client = makeClient();
  return _client;
}

// ---- shared session upsert --------------------------------------------------

// Create-or-update each predictable session as its own class (division + race
// type) with its lineup as entries. Never deletes: classes/entries that drop off
// a later scrape are left in place so existing predictions (which reference
// Entry ids) stay valid. Classes are matched by their composite session
// mrpClassId (unique per session) — never by name alone, since every session of
// a division shares the division name. Entries match by mrpEntryId (stable
// MyRacePass driver id) else driverName+carNumber, refreshing sortOrder to the
// current lineup. Shared by importRaceDetails and importSessions.
async function upsertSessionClasses(
  client: DataClient,
  raceId: string,
  parsedSessions: ReturnType<typeof parseSessions>,
) {
  const existingClasses = await listAll(client.models.RaceClass.listRaceClassByRaceId, {
    raceId,
  });
  let classCount = 0;
  let entryCount = 0;
  let created = 0;
  for (let ci = 0; ci < parsedSessions.length; ci++) {
    const pc = parsedSessions[ci];
    const matchClass = pc.mrpClassId
      ? existingClasses.find((c: any) => c.mrpClassId === pc.mrpClassId)
      : existingClasses.find(
          (c: any) => sameName(c.name, pc.name) && sameName(c.raceType, pc.raceType),
        );
    const classFields = {
      raceId,
      mrpClassId: pc.mrpClassId ?? null,
      name: pc.name,
      raceType: pc.raceType,
      series: null,
      entryCount: pc.entryCount ?? pc.entries.length,
      sortOrder: ci,
    };
    let classId: string;
    if (matchClass) {
      const { data } = await client.models.RaceClass.update({
        id: (matchClass as any).id,
        ...classFields,
      });
      classId = data!.id;
    } else {
      const { data } = await client.models.RaceClass.create(classFields);
      classId = data!.id;
      created++;
    }
    classCount++;

    const existingEntries = await listAll(client.models.Entry.listEntryByClassId, {
      classId,
    });
    for (let ei = 0; ei < pc.entries.length; ei++) {
      const pe = pc.entries[ei];
      const match = existingEntries.find(
        (e: any) =>
          (pe.mrpEntryId && e.mrpEntryId === pe.mrpEntryId) ||
          (e.driverName === pe.driverName && e.carNumber === pe.carNumber),
      );
      const entryFields = {
        raceId,
        classId,
        mrpEntryId: pe.mrpEntryId ?? null,
        carNumber: pe.carNumber ?? null,
        driverName: pe.driverName,
        hometown: pe.hometown ?? null,
        sortOrder: ei,
      };
      if (match) {
        await client.models.Entry.update({ id: (match as any).id, ...entryFields });
      } else {
        await client.models.Entry.create(entryFields);
      }
      entryCount++;
    }
  }
  return { classCount, entryCount, created };
}

// ---- importRaceDetails ------------------------------------------------------

async function importRaceDetails(eventId: string, importedBy: string) {
  const client = await getClient();
  const detailsUrl = `${BASE}/events/${eventId}`;
  const [detailsHtml, parsedSessions] = await Promise.all([
    fetchHtml(detailsUrl),
    fetchParsed(`${BASE}/events/${eventId}/races`, parseSessions),
  ]);

  const details = parseEventDetails(detailsHtml);

  // Upsert the Race by mrpEventId.
  const { data: existingRaces } = await client.models.Race.listRaceByMrpEventId({
    mrpEventId: eventId,
  });
  const now = new Date().toISOString();
  const raceFields = {
    mrpEventId: eventId,
    name: details.name ?? `Event ${eventId}`,
    track: details.track ?? null,
    location: details.location ?? null,
    eventDate: details.eventDate ?? null,
    sourceUrl: detailsUrl,
    detailsScrapedAt: now,
    importedBy,
  };
  let raceId: string;
  if (existingRaces?.[0]) {
    const { data } = await client.models.Race.update({
      id: existingRaces[0].id,
      ...raceFields,
    });
    raceId = data!.id;
  } else {
    const { data } = await client.models.Race.create({
      ...raceFields,
      status: 'scheduled',
      predictionsLocked: false,
    });
    raceId = data!.id;
  }

  // Upsert per-session classes + their lineups from the races page.
  const { classCount, entryCount } = await upsertSessionClasses(
    client,
    raceId,
    parsedSessions,
  );

  return { raceId, mrpEventId: eventId, name: raceFields.name, classCount, entryCount };
}

// ---- importSessions (classes + entries) -------------------------------------

// Import every predictable session (Feature/Heat) for an already-imported race
// from its races page, each as its own class with its lineup as entries. Backs
// both the "Import classes" and "Import entries" admin actions — on MyRacePass a
// session and its lineup are posted together, so there's no separate class-only
// step. Admins run it repeatedly on race day as heat lineups finalize; the
// Race's event details (name/track/date) are left untouched.
async function importSessions(eventId: string) {
  const client = await getClient();

  const { data: races } = await client.models.Race.listRaceByMrpEventId({
    mrpEventId: eventId,
  });
  const race = races?.[0];
  if (!race) {
    throw new Error(
      `No imported race for event ${eventId}. Import race details first.`,
    );
  }

  const parsedSessions = await fetchParsed(
    `${BASE}/events/${eventId}/races`,
    parseSessions,
  );
  const { classCount, entryCount, created } = await upsertSessionClasses(
    client,
    race.id,
    parsedSessions,
  );

  return { raceId: race.id, mrpEventId: eventId, name: race.name, classCount, entryCount, created };
}

// ---- importRaceResults + scoring -------------------------------------------

async function ensureScoringRules(client: any): Promise<Map<number, number>> {
  const { data } = await client.models.ScoringRule.list();
  const source: Array<{ finishPosition: number; points: number }> = data?.length
    ? data
    : DEFAULT_SCORING_RULES;
  if (!data?.length) {
    await Promise.all(
      DEFAULT_SCORING_RULES.map((r) => client.models.ScoringRule.create(r)),
    );
  }
  const map = new Map<number, number>();
  for (const r of source) map.set(Number(r.finishPosition), Number(r.points));
  return map;
}

async function importRaceResults(eventId: string) {
  const client = await getClient();
  const resultsUrl = `${BASE}/events/${eventId}/races`;
  const resultClasses = await fetchParsed(resultsUrl, parseResults);

  const { data: races } = await client.models.Race.listRaceByMrpEventId({
    mrpEventId: eventId,
  });
  const race = races?.[0];
  if (!race) {
    throw new Error(
      `No imported race for event ${eventId}. Import race details first.`,
    );
  }
  const raceId = race.id;

  const classes = await listAll(client.models.RaceClass.listRaceClassByRaceId, { raceId });
  const allEntries = await listAll(client.models.Entry.listEntryByRaceId, { raceId });
  const entryByMrpId = new Map<string, any>();
  for (const e of allEntries as any[]) {
    if (e.mrpEntryId) entryByMrpId.set(e.mrpEntryId, e);
  }

  let resultRowCount = 0;
  for (const rc of resultClasses) {
    // Classes are per-session (division + race type). The results scraper keeps
    // the feature, so match the session class with the same division name AND
    // race type (e.g. "A Feature 1"); fall back to any feature session for that
    // division. Names are compared case-insensitively.
    const cls =
      (classes as any[]).find(
        (c) => sameName(c.name, rc.className) && sameName(c.raceType, rc.sessionName),
      ) ||
      (classes as any[]).find(
        (c) => sameName(c.name, rc.className) && /feature/i.test(c.raceType || ''),
      );
    if (!cls) continue;
    const existingResults = await listAll(
      client.models.RaceResult.listRaceResultByClassId,
      { classId: cls.id },
    );
    for (const row of rc.rows) {
      const entry = row.mrpEntryId ? entryByMrpId.get(row.mrpEntryId) : null;
      const match = existingResults.find(
        (r: any) =>
          row.mrpEntryId
            ? r.mrpEntryId === row.mrpEntryId
            : // No driver id: only match a real finishing position. Matching on
              // finishPosition 0 would collapse every DNS/DNF row into one.
              row.finishPosition > 0 && r.finishPosition === row.finishPosition,
      );
      const fields = {
        raceId,
        classId: cls.id,
        entryId: entry?.id ?? null,
        mrpEntryId: row.mrpEntryId ?? null,
        finishPosition: row.finishPosition,
        startPosition: row.startPosition ?? null,
        carNumber: row.carNumber ?? null,
        driverName: row.driverName ?? null,
        hometown: row.hometown ?? null,
        status: row.status ?? null,
      };
      if (match) {
        await client.models.RaceResult.update({ id: (match as any).id, ...fields });
      } else {
        await client.models.RaceResult.create(fields);
      }
      resultRowCount++;
    }
  }

  // Mark the race completed.
  await client.models.Race.update({
    id: raceId,
    status: 'completed',
    resultsScrapedAt: new Date().toISOString(),
  });

  const scoredPredictions = await scorePredictions(client, raceId);

  return { raceId, mrpEventId: eventId, resultClasses: resultClasses.length, resultRowCount, scoredPredictions };
}

// ---- enterRaceResults (admin manual entry) ---------------------------------

type ManualResultRow = { entryId: string; status?: string | null };
type ManualResultClass = { classId: string; rows: ManualResultRow[] };

const DNX_STATUSES = new Set(['DNF', 'DNS', 'DQ']);

// Save admin-entered finishing order for a race, then score predictions.
// `results` is an array of { classId, rows: [{ entryId, status }] }. Rows are in
// the admin's finish order; a null/blank status is a finisher (assigned the next
// sequential finishPosition), while DNF/DNS/DQ get finishPosition 0 + status
// (matching the scrape convention — those sort last and are non-scorable).
// Each listed class's RaceResult rows are replaced wholesale so re-entry is
// idempotent and corrections overwrite cleanly.
async function enterRaceResults(raceId: string, results: ManualResultClass[]) {
  const client = await getClient();

  const { data: race } = await client.models.Race.get({ id: raceId });
  if (!race) throw new Error(`No race found for id ${raceId}.`);

  const allEntries = await listAll(client.models.Entry.listEntryByRaceId, { raceId });
  const entryById = new Map<string, any>(
    (allEntries as any[]).map((e) => [e.id, e]),
  );

  const scoredClassIds = new Set<string>();
  let resultRowCount = 0;
  for (const rc of results ?? []) {
    if (!rc?.classId || !Array.isArray(rc.rows)) continue;
    scoredClassIds.add(rc.classId);

    // Replace this class's existing results so a re-entry can't leave stale rows.
    const existingResults = await listAll(
      client.models.RaceResult.listRaceResultByClassId,
      { classId: rc.classId },
    );
    for (const r of existingResults as any[]) {
      await client.models.RaceResult.delete({ id: r.id });
    }

    let nextPosition = 1;
    for (const row of rc.rows) {
      const entry = entryById.get(row.entryId);
      if (!entry) continue; // skip unknown/removed entries defensively
      const status =
        row.status && DNX_STATUSES.has(row.status) ? row.status : null;
      const finishPosition = status ? 0 : nextPosition++;
      await client.models.RaceResult.create({
        raceId,
        classId: rc.classId,
        entryId: entry.id,
        mrpEntryId: entry.mrpEntryId ?? null,
        finishPosition,
        startPosition: null,
        carNumber: entry.carNumber ?? null,
        driverName: entry.driverName ?? null,
        hometown: entry.hometown ?? null,
        status,
      });
      resultRowCount++;
    }
  }

  // Classes are scored one at a time, so only flip the race to "completed" once
  // every class has results — otherwise leave its current status untouched.
  const classes = await listAll(client.models.RaceClass.listRaceClassByRaceId, { raceId });
  const allResults = await listAll(client.models.RaceResult.listRaceResultByRaceId, { raceId });
  const classesWithResults = new Set((allResults as any[]).map((r) => r.classId));
  const raceCompleted =
    classes.length > 0 &&
    (classes as any[]).every((c) => classesWithResults.has(c.id));

  await client.models.Race.update({
    id: raceId,
    status: raceCompleted ? 'completed' : race.status ?? 'scheduled',
    resultsScrapedAt: new Date().toISOString(),
  });

  const scoredPredictions = await scorePredictions(client, raceId, scoredClassIds);

  return {
    raceId,
    resultClasses: scoredClassIds.size,
    resultRowCount,
    scoredPredictions,
    raceCompleted,
  };
}

// ---- clearPredictions (admin reset) ----------------------------------------

// Delete predictions to reset the game. Scoped to one race when `raceId` is
// given, otherwise every prediction. Results, classes, entries and users are
// left untouched — only the users' picks and scores are removed.
async function clearPredictions(raceId?: string) {
  const client = await getClient();
  const predictions = raceId
    ? await listAll(client.models.Prediction.listPredictionByRaceId, { raceId })
    : await listAll(client.models.Prediction.list);

  let deleted = 0;
  for (const p of predictions as any[]) {
    const { errors } = await client.models.Prediction.delete({ id: p.id });
    if (errors?.length) {
      console.error(`[clear] failed to delete prediction ${p.id}`, errors);
      throw new Error(`Failed to delete prediction ${p.id}: ${errors[0].message}`);
    }
    deleted++;
  }
  console.log(`[clear] deleted ${deleted} predictions${raceId ? ` for race ${raceId}` : ' (all races)'}`);
  return { raceId: raceId ?? null, deleted };
}

// For each class, actual finish position -> the Entry id that finished there.
async function buildFinishMaps(client: any, raceId: string) {
  const results = await listAll(client.models.RaceResult.listRaceResultByRaceId, { raceId });
  const byClass = new Map<string, Map<number, string>>();
  for (const r of results as any[]) {
    if (!r.entryId || !r.finishPosition) continue;
    if (!byClass.has(r.classId)) byClass.set(r.classId, new Map());
    byClass.get(r.classId)!.set(r.finishPosition, r.entryId);
  }
  return byClass;
}

// Score predictions for a race. When `classIds` is given, only predictions in
// those classes are (re)scored — used by per-class manual entry so scoring one
// class never touches another class's predictions. Omit it to score them all
// (the results-scraper path).
async function scorePredictions(client: any, raceId: string, classIds?: Set<string>) {
  const ruleMap = await ensureScoringRules(client);
  const finishMaps = await buildFinishMaps(client, raceId);
  const predictions = await listAll(client.models.Prediction.listPredictionByRaceId, { raceId });

  const inScope = (predictions as any[]).filter(
    (p) => !classIds || classIds.has(p.classId),
  );
  console.log(
    `[score] race ${raceId}: ${predictions.length} predictions total, ` +
      `${inScope.length} in scope${classIds ? ` for classes ${[...classIds].join(',')}` : ''}`,
  );

  let scored = 0;
  for (const p of inScope) {
    const actual = finishMaps.get(p.classId);
    const ordered: string[] = (p.orderedEntryIds ?? []).filter(Boolean);
    let points = 0;
    if (actual) {
      // F1-style: award points(pos) when the entry the user placed at position
      // `pos` actually finished at `pos`.
      for (const [pos, pts] of ruleMap) {
        const predictedEntryId = ordered[pos - 1];
        if (predictedEntryId && actual.get(pos) === predictedEntryId) {
          points += pts;
        }
      }
    }
    // The data client returns GraphQL errors in the result rather than throwing;
    // surface them so a rejected update can't look like a silent success.
    const { errors } = await client.models.Prediction.update({
      id: p.id,
      pointsAwarded: points,
      scoredAt: new Date().toISOString(),
    });
    if (errors?.length) {
      console.error(`[score] failed to update prediction ${p.id}`, errors);
      throw new Error(`Failed to score prediction ${p.id}: ${errors[0].message}`);
    }
    scored++;
  }
  return scored;
}

// ---- entrypoint -------------------------------------------------------------

export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const importedBy =
    (event.identity as any)?.username ||
    (event.identity as any)?.sub ||
    'admin';

  // Amplify's custom-mutation resolver puts the field name at the top level of
  // the event; the AppSyncResolverEvent type declares it under `info`. Read both.
  const fieldName =
    (event as any).fieldName ?? (event as any).info?.fieldName;

  // Admin manual results entry uses a different argument shape (raceId + a JSON
  // results payload) than the eventId-keyed scrape imports.
  if (fieldName === 'enterRaceResults') {
    const args = event.arguments as any;
    const raceId = String(args.raceId ?? '').trim();
    if (!raceId) throw new Error('raceId is required');
    const results =
      typeof args.results === 'string' ? JSON.parse(args.results) : args.results;
    return enterRaceResults(raceId, results as ManualResultClass[]);
  }

  // Admin reset: clear predictions for one race (raceId) or all races (no arg).
  if (fieldName === 'clearPredictions') {
    const args = event.arguments as any;
    const raceId = args.raceId ? String(args.raceId).trim() : undefined;
    return clearPredictions(raceId || undefined);
  }

  const eventId = String(event.arguments.eventId).trim();
  if (!eventId) throw new Error('eventId is required');

  switch (fieldName) {
    case 'importRaceDetails':
      return importRaceDetails(eventId, importedBy);
    case 'importRaceClasses':
    case 'importRaceEntries':
      return importSessions(eventId);
    case 'importRaceResults':
      return importRaceResults(eventId);
    default:
      throw new Error(`Unsupported field: ${fieldName}`);
  }
};
