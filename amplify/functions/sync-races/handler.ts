import type { Handler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/sync-races';
import type { Schema } from '../../data/resource.js';

/**
 * Scheduled race-sync Lambda. Ports the legacy `server/src/services/raceSync.js`
 * logic onto AppSync/DynamoDB via the Amplify Data client.
 *
 * Currently wired to the mock provider so it works out of the box. Swap
 * `loadRaces` to call the Race Monitor API when you flip RACE_PROVIDER.
 */

type ProviderRace = {
  external_id: string;
  name: string;
  series?: string | null;
  track?: string | null;
  start_time?: string | null;
  status: 'scheduled' | 'active' | 'finished';
  drivers: ProviderDriver[];
  finishOrder: string[] | null;
};

type ProviderDriver = {
  external_id: string;
  number?: string | null;
  name: string;
  active: boolean;
};

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

function isoOffset(hours: number) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function makeDrivers(prefix: string, names: string[]): ProviderDriver[] {
  return names.map((name, i) => ({
    external_id: `${prefix}-D${i + 1}`,
    number: String((i + 1) * 2 + 1),
    name,
    active: true,
  }));
}

const GRID_A = makeDrivers('A', [
  'Alex Stone', 'Maria Cruz', 'Liam Park', 'Noah Reed', 'Emma Frost',
  'Owen Diaz', 'Ava Lin', 'Mason Vale', 'Sofia Ruiz', 'Jack Moon',
]);
const GRID_B = makeDrivers('B', [
  'Ethan Wolfe', 'Olivia Snow', 'Lucas Grey', 'Mia Quinn', 'Henry Vale',
  'Zoe Banks', 'Caleb Fox', 'Nina Hart', 'Ryan Cole', 'Lily Dawn',
]);
const GRID_C = makeDrivers('C', [
  'Marco Bell', 'Ruby Lane', 'Dylan Ash', 'Ivy Stone', 'Felix Kerr',
  'Grace Bond', 'Theo Rivers', 'Hazel Pike', 'Sam Webb', 'Clara Vance',
]);

function finishFor(drivers: ProviderDriver[]): string[] {
  const ids = drivers.map((d) => d.external_id);
  return [...ids.slice(3), ...ids.slice(0, 3)];
}

const mockRaces: ProviderRace[] = [
  {
    external_id: 'RM-1001',
    name: 'Spring Cup — Round 1',
    series: 'GT Sprint',
    track: 'Riverside International',
    start_time: isoOffset(-72),
    status: 'finished',
    drivers: GRID_A,
    finishOrder: finishFor(GRID_A),
  },
  {
    external_id: 'RM-1002',
    name: 'Midnight Endurance',
    series: 'Endurance Series',
    track: 'Nightfall Speedway',
    start_time: isoOffset(-1),
    status: 'active',
    drivers: GRID_B,
    finishOrder: null,
  },
  {
    external_id: 'RM-1003',
    name: 'Summer Grand Prix',
    series: 'GT Sprint',
    track: 'Sunset Circuit',
    start_time: isoOffset(48),
    status: 'scheduled',
    drivers: GRID_C,
    finishOrder: null,
  },
  {
    external_id: 'RM-1004',
    name: 'Coastal Challenge',
    series: 'Touring Cup',
    track: 'Harborline Raceway',
    start_time: isoOffset(120),
    status: 'scheduled',
    drivers: GRID_A,
    finishOrder: null,
  },
];

async function loadRaces(): Promise<ProviderRace[]> {
  if (env.RACE_PROVIDER === 'racemonitor') {
    // TODO: port RaceMonitorProvider.js fetch logic here. The token is wired
    // via secret('RACE_MONITOR_TOKEN') in resource.ts — uncomment that block,
    // then read env.RACE_MONITOR_TOKEN at runtime.
    console.warn('racemonitor provider not yet implemented in Lambda; falling back to mock');
  }
  return mockRaces;
}

export const handler: Handler = async () => {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  const client = generateClient<Schema>();

  const providerRaces = await loadRaces();

  // 1. Ensure scoring rules exist (one-time seed).
  const { data: existingRules } = await client.models.ScoringRule.list();
  if (!existingRules?.length) {
    await Promise.all(
      DEFAULT_SCORING_RULES.map((rule) => client.models.ScoringRule.create(rule)),
    );
  }
  const ruleMap = new Map<number, number>(
    DEFAULT_SCORING_RULES.map((r) => [r.finishPosition, r.points]),
  );

  let syncedRaces = 0;

  for (const pr of providerRaces) {
    // Upsert race by externalId.
    const { data: matches } = await client.models.Race.listRaceByExternalId({
      externalId: pr.external_id,
    });
    const existing = matches?.[0];
    let raceId: string;
    if (existing) {
      const { data: updated } = await client.models.Race.update({
        id: existing.id,
        name: pr.name,
        series: pr.series ?? null,
        track: pr.track ?? null,
        startTime: pr.start_time ?? null,
        status: pr.status,
        syncedAt: new Date().toISOString(),
      });
      raceId = updated!.id;
    } else {
      const { data: created } = await client.models.Race.create({
        externalId: pr.external_id,
        name: pr.name,
        series: pr.series ?? null,
        track: pr.track ?? null,
        startTime: pr.start_time ?? null,
        status: pr.status,
        syncedAt: new Date().toISOString(),
      });
      raceId = created!.id;
    }
    syncedRaces++;

    // Upsert drivers (by raceId + externalId).
    const { data: existingDrivers } = await client.models.Driver.listDriverByRaceId({
      raceId,
    });
    const driverByExt = new Map(
      (existingDrivers ?? []).map((d) => [d.externalId, d]),
    );
    const driverIdByExt = new Map<string, string>();
    for (const d of pr.drivers) {
      const found = driverByExt.get(d.external_id);
      if (found) {
        await client.models.Driver.update({
          id: found.id,
          number: d.number ?? null,
          name: d.name,
          active: d.active,
        });
        driverIdByExt.set(d.external_id, found.id);
      } else {
        const { data: created } = await client.models.Driver.create({
          raceId,
          externalId: d.external_id,
          number: d.number ?? null,
          name: d.name,
          active: d.active,
        });
        if (created) driverIdByExt.set(d.external_id, created.id);
      }
    }

    // Upsert results for finished races, then score picks.
    if (pr.status === 'finished' && pr.finishOrder) {
      const { data: existingResults } = await client.models.RaceResult.listRaceResultByRaceId({
        raceId,
      });
      const resultByDriverId = new Map(
        (existingResults ?? []).map((r) => [r.driverId, r]),
      );
      const positionByDriverId = new Map<string, number>();

      for (let i = 0; i < pr.finishOrder.length; i++) {
        const driverExtId = pr.finishOrder[i];
        const driverId = driverIdByExt.get(driverExtId);
        if (!driverId) continue;
        const finishPosition = i + 1;
        positionByDriverId.set(driverId, finishPosition);
        const existingResult = resultByDriverId.get(driverId);
        if (existingResult) {
          await client.models.RaceResult.update({
            id: existingResult.id,
            finishPosition,
            status: 'Classified',
          });
        } else {
          await client.models.RaceResult.create({
            raceId,
            driverId,
            finishPosition,
            status: 'Classified',
          });
        }
      }

      // Score any unscored picks for this race.
      const { data: picks } = await client.models.Pick.listPickByRaceId({ raceId });
      for (const pick of picks ?? []) {
        if (pick.scoredAt) continue;
        const pos = positionByDriverId.get(pick.driverId);
        const points = pos ? ruleMap.get(pos) ?? 0 : 0;
        await client.models.Pick.update({
          id: pick.id,
          pointsAwarded: points,
          scoredAt: new Date().toISOString(),
        });
      }
    }
  }

  console.log(`Synced ${syncedRaces} races.`);
  return { syncedRaces };
};
