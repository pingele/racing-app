import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { scrapeRace } from '../functions/scrape-race/resource.js';
import { manageAdmin } from '../functions/manage-admin/resource.js';

/**
 * Data model for the MyRacePass scraper + finish-order prediction game.
 *
 * Admins scrape MyRacePass events (details + entries + results) on demand via
 * the `importRaceDetails` / `importRaceResults` custom mutations, both backed by
 * the `scrape-race` Lambda. Signed-in users predict the full finish order of the
 * entries in each class; importing results scores those predictions F1-style.
 *
 * Models are linked by scalar foreign-key fields + secondary indexes (the app
 * reads exclusively via the generated `listXByY` index queries and `get`), so
 * no `hasMany`/`belongsTo` relationships are declared.
 */
const schema = a.schema({
  // One MyRacePass event (e.g. a race night at a track).
  Race: a
    .model({
      mrpEventId: a.string().required(), // the ID an admin types in
      name: a.string().required(),
      track: a.string(),
      location: a.string(),
      eventDate: a.datetime(),
      status: a.string(), // 'scheduled' | 'completed'
      sourceUrl: a.string(),
      predictionsLocked: a.boolean().default(false),
      hidden: a.boolean().default(false), // hidden from the public Races screen; still shown in Admin
      detailsScrapedAt: a.datetime(),
      resultsScrapedAt: a.datetime(),
      importedBy: a.string(),
    })
    .secondaryIndexes((index) => [index('mrpEventId').name('byMrpEventId')])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  // A division within an event (e.g. "DIRTcar Late Models").
  RaceClass: a
    .model({
      raceId: a.id().required(),
      mrpClassId: a.string(),
      name: a.string().required(),
      series: a.string(),
      entryCount: a.integer(),
      sortOrder: a.integer(),
    })
    .secondaryIndexes((index) => [index('raceId').name('byRace')])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  // A car/driver entered in a class lineup — the unit users order.
  Entry: a
    .model({
      raceId: a.id().required(),
      classId: a.id().required(),
      mrpEntryId: a.string(), // MyRacePass driver id (links entries <-> results)
      carNumber: a.string(),
      driverName: a.string().required(),
      hometown: a.string(),
      sortOrder: a.integer(),
    })
    .secondaryIndexes((index) => [
      index('raceId').name('byRace'),
      index('classId').name('byClass'),
    ])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  // The actual finishing order of a class's A-Feature.
  RaceResult: a
    .model({
      raceId: a.id().required(),
      classId: a.id().required(),
      entryId: a.id(),
      mrpEntryId: a.string(),
      finishPosition: a.integer().required(),
      startPosition: a.integer(),
      carNumber: a.string(),
      driverName: a.string(),
      hometown: a.string(),
      status: a.string(),
      lapsCompleted: a.integer(),
    })
    .secondaryIndexes((index) => [
      index('raceId').name('byRace'),
      index('classId').name('byClass'),
    ])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  // A user's predicted finish order for one class within an event.
  Prediction: a
    .model({
      raceId: a.id().required(),
      classId: a.id().required(),
      userId: a.string().required(), // Cognito sub (lets the Lambda match owners)
      displayName: a.string(),
      orderedEntryIds: a.string().array(), // Entry IDs, predicted 1st -> last
      pointsAwarded: a.integer(),
      scoredAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('raceId').name('byRace'),
      index('classId').name('byClass'),
    ])
    .authorization((allow) => [
      // Each user owns their predictions (CRUD on own rows).
      allow.owner(),
      // All signed-in users can read predictions (powers the Standings page).
      allow.authenticated().to(['read']),
    ]),

  // Configurable F1-style points table (1 -> 25, 2 -> 18, ...).
  ScoringRule: a
    .model({
      finishPosition: a.integer().required(),
      points: a.integer().required(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  // App-level user storage (profile/role) keyed to the Cognito identity.
  UserProfile: a
    .model({
      userId: a.string().required(),
      displayName: a.string(),
      email: a.string(),
      role: a.string(),
    })
    .secondaryIndexes((index) => [index('userId').name('byUserId')])
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(['read']),
    ]),

  // ---- On-demand admin scrape mutations (backed by the scrape-race Lambda) ----
  importRaceDetails: a
    .mutation()
    .arguments({ eventId: a.string().required() })
    .returns(a.json())
    .handler(a.handler.function(scrapeRace))
    .authorization((allow) => [allow.group('Admins')]),

  importRaceResults: a
    .mutation()
    .arguments({ eventId: a.string().required() })
    .returns(a.json())
    .handler(a.handler.function(scrapeRace))
    .authorization((allow) => [allow.group('Admins')]),

  // Grant/revoke a user's admin access (edits Cognito `Admins` group membership
  // and syncs the UserProfile.role mirror). `userId` is the target's Cognito sub.
  setAdminRole: a
    .mutation()
    .arguments({ userId: a.string().required(), makeAdmin: a.boolean().required() })
    .returns(a.json())
    .handler(a.handler.function(manageAdmin))
    .authorization((allow) => [allow.group('Admins')]),
}).authorization((allow) => [
  // Grant the scrape-race Lambda read + write access to the data API so its
  // handler can upsert scraped rows and score predictions.
  allow.resource(scrapeRace).to(['query', 'mutate']),
  // Grant the manage-admin Lambda access so it can sync UserProfile.role.
  allow.resource(manageAdmin).to(['query', 'mutate']),
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
