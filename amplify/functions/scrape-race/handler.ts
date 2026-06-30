import type { AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/scrape-race';
import type { Schema } from '../../data/resource.js';
import {
  parseEventDetails,
  parseEntries,
  parseResults,
} from './myracepass.js';

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

// ---- importRaceDetails ------------------------------------------------------

async function importRaceDetails(eventId: string, importedBy: string) {
  const client = await getClient();
  const detailsUrl = `${BASE}/events/${eventId}`;
  const [detailsHtml, parsedClasses] = await Promise.all([
    fetchHtml(detailsUrl),
    fetchParsed(`${BASE}/events/${eventId}/entries`, parseEntries),
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

  // Upsert classes + entries.
  const existingClasses = await listAll(client.models.RaceClass.listRaceClassByRaceId, {
    raceId,
  });
  let classCount = 0;
  let entryCount = 0;
  for (let ci = 0; ci < parsedClasses.length; ci++) {
    const pc = parsedClasses[ci];
    const matchClass = existingClasses.find(
      (c: any) =>
        (pc.mrpClassId && c.mrpClassId === pc.mrpClassId) || c.name === pc.name,
    );
    const classFields = {
      raceId,
      mrpClassId: pc.mrpClassId ?? null,
      name: pc.name,
      series: pc.series ?? null,
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

  return { raceId, mrpEventId: eventId, name: raceFields.name, classCount, entryCount };
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
    const cls = (classes as any[]).find(
      (c) => (rc.mrpClassId && c.mrpClassId === rc.mrpClassId) || c.name === rc.className,
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

async function scorePredictions(client: any, raceId: string) {
  const ruleMap = await ensureScoringRules(client);
  const finishMaps = await buildFinishMaps(client, raceId);
  const predictions = await listAll(client.models.Prediction.listPredictionByRaceId, { raceId });

  let scored = 0;
  for (const p of predictions as any[]) {
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
    await client.models.Prediction.update({
      id: p.id,
      pointsAwarded: points,
      scoredAt: new Date().toISOString(),
    });
    scored++;
  }
  return scored;
}

// ---- entrypoint -------------------------------------------------------------

export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const eventId = String(event.arguments.eventId).trim();
  if (!eventId) throw new Error('eventId is required');
  const importedBy =
    (event.identity as any)?.username ||
    (event.identity as any)?.sub ||
    'admin';

  // Amplify's custom-mutation resolver puts the field name at the top level of
  // the event; the AppSyncResolverEvent type declares it under `info`. Read both.
  const fieldName =
    (event as any).fieldName ?? (event as any).info?.fieldName;

  switch (fieldName) {
    case 'importRaceDetails':
      return importRaceDetails(eventId, importedBy);
    case 'importRaceResults':
      return importRaceResults(eventId);
    default:
      throw new Error(`Unsupported field: ${fieldName}`);
  }
};
