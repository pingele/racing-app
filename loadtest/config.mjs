// Shared configuration for the load-test harness. Reads the deployed backend's
// amplify_outputs.json (one directory up) so every script points at the same
// Cognito pool + AppSync endpoint without hardcoding anything.
//
// IMPORTANT: point this at a DEDICATED, throwaway backend — never production.
// The scripts read whichever amplify_outputs.json is at the repo root, so run
// `npx ampx sandbox` (or deploy a dedicated branch) and use that output.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outputs = JSON.parse(
  readFileSync(resolve(here, '..', 'amplify_outputs.json'), 'utf8'),
);

export const REGION = outputs.auth.aws_region;
export const USER_POOL_ID = outputs.auth.user_pool_id;
export const APP_CLIENT_ID = outputs.auth.user_pool_client_id;

export const GRAPHQL_HTTP = outputs.data.url;
export const GRAPHQL_WS = GRAPHQL_HTTP.replace(
  'appsync-api',
  'appsync-realtime-api',
).replace('https://', 'wss://');
// The AppSync API id is the first label of the endpoint host; it also prefixes
// the DynamoDB table names Amplify generates.
export const API_ID = new URL(GRAPHQL_HTTP).host.split('.')[0];
export const HTTP_HOST = new URL(GRAPHQL_HTTP).host;

// ---- Tunables (env-overridable) --------------------------------------------
export const num = (name, def) => Number(process.env[name] ?? def);

export const USER_COUNT = num('LT_USERS', 2000);
export const EMAIL_DOMAIN = process.env.LT_EMAIL_DOMAIN ?? 'loadtest.local';
export const EMAIL_PREFIX = process.env.LT_EMAIL_PREFIX ?? 'lt-';
// Test-only credential. These are throwaway accounts in a throwaway pool.
export const PASSWORD = process.env.LT_PASSWORD ?? 'LoadTest!2345';

// Name of the dedicated app client the harness creates for USER_PASSWORD_AUTH.
export const LT_CLIENT_NAME = process.env.LT_CLIENT_NAME ?? 'loadtest-user-password-client';

export const emailFor = (i) =>
  `${EMAIL_PREFIX}${String(i).padStart(5, '0')}@${EMAIL_DOMAIN}`;

export const paths = {
  users: new URL('./users.json', import.meta.url),
  tokens: new URL('./tokens.json', import.meta.url),
  client: new URL('./ltclient.json', import.meta.url),
  seed: new URL('./seed-manifest.json', import.meta.url),
};
