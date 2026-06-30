import { defineFunction } from '@aws-amplify/backend';

/**
 * On-demand Lambda that scrapes a MyRacePass event (details, entries, results)
 * and upserts it into AppSync/DynamoDB. Exposed to the admin UI as the
 * `importRaceDetails` and `importRaceResults` custom mutations (see
 * `amplify/data/resource.ts`). The handler branches on `event.fieldName`.
 *
 * Not scheduled — invoked only when an admin clicks an import button.
 */
export const scrapeRace = defineFunction({
  name: 'scrape-race',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    MRP_BASE_URL: process.env.MRP_BASE_URL ?? 'https://www.myracepass.com',
  },
});
