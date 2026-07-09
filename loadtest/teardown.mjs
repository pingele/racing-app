// Remove the persistent artifacts this harness leaves in the Cognito pool:
// every test user (matched by the email prefix) and the dedicated app client.
//
//   node teardown.mjs
//
// Seeded DynamoDB data is NOT deleted here — the intended workflow is to run
// against a throwaway backend and delete the whole sandbox afterward
// (`npx ampx sandbox delete`). Requires AWS credentials.
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminDeleteUserCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { REGION, USER_POOL_ID, EMAIL_PREFIX, paths } from './config.mjs';
import { mapLimit, withRetry } from './util.mjs';

const cog = new CognitoIdentityProviderClient({ region: REGION });

// Collect all users whose email starts with the load-test prefix.
async function findTestUsers() {
  const users = [];
  let token;
  do {
    const res = await withRetry(() =>
      cog.send(
        new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Limit: 60,
          PaginationToken: token,
        }),
      ),
    );
    for (const u of res.Users ?? []) {
      const email = u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '';
      if (email.startsWith(EMAIL_PREFIX)) users.push(u.Username);
    }
    token = res.PaginationToken;
  } while (token);
  return users;
}

const usernames = await findTestUsers();
console.log(`Deleting ${usernames.length} test users…`);
let done = 0;
await mapLimit(usernames, 15, async (Username) => {
  await withRetry(() =>
    cog.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username })),
  );
  if (++done % 100 === 0) console.log(`  ${done}/${usernames.length}`);
});

// Delete the dedicated app client, if we recorded it.
if (existsSync(paths.client)) {
  const { clientId } = JSON.parse(readFileSync(paths.client, 'utf8'));
  try {
    await cog.send(
      new DeleteUserPoolClientCommand({
        UserPoolId: USER_POOL_ID,
        ClientId: clientId,
      }),
    );
    console.log('Deleted dedicated load-test app client.');
  } catch (err) {
    console.error(`Could not delete app client: ${err.name}`);
  }
}

// Clean up local artifacts.
for (const p of [paths.users, paths.tokens, paths.client]) {
  if (existsSync(p)) rmSync(p);
}
console.log(
  'Cognito teardown complete. To remove seeded data, delete the sandbox backend.',
);
