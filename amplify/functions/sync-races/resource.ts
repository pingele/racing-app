import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Scheduled Lambda that pulls races/drivers/results from the configured race
 * provider and upserts them into AppSync/DynamoDB. Replaces the on-demand
 * sync logic in the legacy Express server.
 *
 * Schedule: every 15 minutes. Adjust as needed.
 */
export const syncRaces = defineFunction({
  name: 'sync-races',
  entry: './handler.ts',
  schedule: 'every 15m',
  timeoutSeconds: 60,
  environment: {
    RACE_PROVIDER: process.env.RACE_PROVIDER ?? 'mock',
    RACE_MONITOR_BASE_URL:
      process.env.RACE_MONITOR_BASE_URL ?? 'https://api.race-monitor.com',
  },
  // Uncomment once you have set the secret via:  npx ampx sandbox secret set RACE_MONITOR_TOKEN
  // secrets: {
  //   RACE_MONITOR_TOKEN: secret('RACE_MONITOR_TOKEN'),
  // },
});
