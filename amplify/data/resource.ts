import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { syncRaces } from '../functions/sync-races/resource.js';

const schema = a.schema({
  Race: a
    .model({
      externalId: a.string().required(),
      name: a.string().required(),
      series: a.string(),
      track: a.string(),
      startTime: a.datetime(),
      status: a.enum(['scheduled', 'active', 'finished']),
      syncedAt: a.datetime(),
      drivers: a.hasMany('Driver', 'raceId'),
      results: a.hasMany('RaceResult', 'raceId'),
      picks: a.hasMany('Pick', 'raceId'),
    })
    .secondaryIndexes((index) => [index('externalId').name('byExternalId')])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.resource(syncRaces),
    ]),

  Driver: a
    .model({
      raceId: a.id().required(),
      race: a.belongsTo('Race', 'raceId'),
      externalId: a.string().required(),
      number: a.string(),
      name: a.string().required(),
      active: a.boolean().default(true),
      picks: a.hasMany('Pick', 'driverId'),
      results: a.hasMany('RaceResult', 'driverId'),
    })
    .secondaryIndexes((index) => [index('raceId').name('byRace')])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.resource(syncRaces),
    ]),

  RaceResult: a
    .model({
      raceId: a.id().required(),
      race: a.belongsTo('Race', 'raceId'),
      driverId: a.id().required(),
      driver: a.belongsTo('Driver', 'driverId'),
      finishPosition: a.integer().required(),
      status: a.string(),
      laps: a.integer(),
      bestLapTime: a.string(),
      lastLapTime: a.string(),
      totalTime: a.string(),
    })
    .secondaryIndexes((index) => [index('raceId').name('byRace')])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.resource(syncRaces),
    ]),

  Pick: a
    .model({
      raceId: a.id().required(),
      race: a.belongsTo('Race', 'raceId'),
      driverId: a.id().required(),
      driver: a.belongsTo('Driver', 'driverId'),
      displayName: a.string(),
      pointsAwarded: a.integer(),
      scoredAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('raceId').name('byRace'),
    ])
    .authorization((allow) => [
      // Each user owns their picks (CRUD on own rows).
      allow.owner(),
      // All signed-in users can read picks (powers the leaderboard).
      allow.authenticated().to(['read']),
      // The scheduled sync function writes pointsAwarded / scoredAt.
      allow.resource(syncRaces),
    ]),

  ScoringRule: a
    .model({
      finishPosition: a.integer().required(),
      points: a.integer().required(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.resource(syncRaces),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
