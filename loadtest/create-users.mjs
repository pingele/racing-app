// Bulk-create confirmed Cognito test users with permanent passwords.
// Idempotent: re-running reuses existing users (matched by email) and just
// re-asserts the password. Writes users.json = [{ email, nickname, sub }].
//
//   node create-users.mjs            # creates LT_USERS (default 2000) users
//   LT_USERS=500 node create-users.mjs
//
// Requires AWS credentials with Cognito admin permissions on the pool.
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { writeFileSync } from 'node:fs';
import {
  REGION,
  USER_POOL_ID,
  USER_COUNT,
  PASSWORD,
  emailFor,
  paths,
} from './config.mjs';
import { mapLimit, withRetry } from './util.mjs';

const cog = new CognitoIdentityProviderClient({ region: REGION });

async function subForEmail(email) {
  const res = await withRetry(() =>
    cog.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email = "${email}"`,
        Limit: 1,
      }),
    ),
  );
  return res.Users?.[0]?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;
}

async function ensureUser(i) {
  const email = emailFor(i);
  const nickname = `Load Tester ${i}`;
  let sub;
  let created = false;
  try {
    const res = await withRetry(() =>
      cog.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          MessageAction: 'SUPPRESS', // no invitation email
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'nickname', Value: nickname },
          ],
        }),
      ),
    );
    sub = res.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    created = true;
  } catch (err) {
    if (err.name !== 'UsernameExistsException') throw err;
    sub = await subForEmail(email);
  }
  // Set a permanent password so the account is CONFIRMED and can auth headless.
  await withRetry(() =>
    cog.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: PASSWORD,
        Permanent: true,
      }),
    ),
  );
  return { email, nickname, sub, created };
}

console.log(
  `Creating/ensuring ${USER_COUNT} test users in pool ${USER_POOL_ID}…`,
);
let done = 0;
const indices = Array.from({ length: USER_COUNT }, (_, i) => i + 1);
const users = await mapLimit(indices, 15, async (i) => {
  const u = await ensureUser(i);
  if (++done % 100 === 0) console.log(`  ${done}/${USER_COUNT}`);
  return u;
});

writeFileSync(paths.users, JSON.stringify(users, null, 2));
const newlyCreated = users.filter((u) => u.created).length;
console.log(
  `Wrote users.json — ${users.length} users (${newlyCreated} newly created, ${
    users.length - newlyCreated
  } reused).`,
);
