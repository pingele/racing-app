// Pre-mint Cognito ID tokens for every test user and write tokens.json.
//
// Uses a DEDICATED app client (created once, idempotently) that permits
// USER_PASSWORD_AUTH, so we never modify the app's real SRP client and can
// authenticate in parallel. Tokens last ~1h — mint them right before a run.
//
//   node mint-tokens.mjs
//
// Requires AWS credentials (only to create/find the dedicated client; the
// per-user InitiateAuth calls themselves are unauthenticated public-client
// calls). If AppSync rejects these tokens as Unauthorized, enable
// USER_PASSWORD_AUTH on the app's own client and set LT_USE_APP_CLIENT=1.
import {
  CognitoIdentityProviderClient,
  ListUserPoolClientsCommand,
  CreateUserPoolClientCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  REGION,
  USER_POOL_ID,
  APP_CLIENT_ID,
  PASSWORD,
  LT_CLIENT_NAME,
  paths,
} from './config.mjs';
import { mapLimit, withRetry } from './util.mjs';

const cog = new CognitoIdentityProviderClient({ region: REGION });

async function ensureClientId() {
  if (process.env.LT_USE_APP_CLIENT === '1') return APP_CLIENT_ID;

  let next;
  do {
    const res = await cog.send(
      new ListUserPoolClientsCommand({
        UserPoolId: USER_POOL_ID,
        MaxResults: 60,
        NextToken: next,
      }),
    );
    const found = res.UserPoolClients?.find((c) => c.ClientName === LT_CLIENT_NAME);
    if (found) return found.ClientId;
    next = res.NextToken;
  } while (next);

  const created = await cog.send(
    new CreateUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientName: LT_CLIENT_NAME,
      GenerateSecret: false, // public client → no SECRET_HASH needed
      ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      IdTokenValidity: 1,
      AccessTokenValidity: 1,
      RefreshTokenValidity: 1,
      TokenValidityUnits: {
        IdToken: 'hours',
        AccessToken: 'hours',
        RefreshToken: 'days',
      },
    }),
  );
  console.log(`Created dedicated load-test app client "${LT_CLIENT_NAME}".`);
  return created.UserPoolClient.ClientId;
}

const users = JSON.parse(readFileSync(paths.users, 'utf8'));
const clientId = await ensureClientId();
writeFileSync(paths.client, JSON.stringify({ clientId, name: LT_CLIENT_NAME }, null, 2));

console.log(`Minting ID tokens for ${users.length} users…`);
let done = 0;
let failures = 0;
const tokens = await mapLimit(users, 20, async (u) => {
  try {
    const res = await withRetry(
      () =>
        cog.send(
          new InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: clientId,
            AuthParameters: { USERNAME: u.email, PASSWORD },
          }),
        ),
      { tries: 8 },
    );
    if (++done % 100 === 0) console.log(`  ${done}/${users.length}`);
    return res.AuthenticationResult?.IdToken ?? null;
  } catch (err) {
    failures++;
    if (failures <= 5) console.error(`  auth failed for ${u.email}: ${err.name}`);
    return null;
  }
});

const good = tokens.filter(Boolean);
writeFileSync(paths.tokens, JSON.stringify(good, null, 2));
console.log(
  `Wrote tokens.json — ${good.length} tokens (${failures} failures). Tokens expire in ~1h.`,
);
