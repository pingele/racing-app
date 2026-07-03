import type { AppSyncResolverHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/manage-admin';
import type { Schema } from '../../data/resource.js';

/**
 * Grant or revoke admin access for one user. Admin gating reads the Cognito
 * `Admins` group claim, so this adds/removes the user's group membership (the
 * source of truth) and then updates the app-level `UserProfile.role` mirror so
 * the admin list reflects the change immediately — the frontend can't write
 * another user's profile row (owner-only auth).
 */

type Args = { userId: string; makeAdmin: boolean };

const cognito = new CognitoIdentityProviderClient();

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
async function getClient() {
  if (_client) return _client;
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  _client = generateClient<Schema>();
  return _client;
}

export const handler: AppSyncResolverHandler<Args, unknown> = async (event) => {
  const userId = String(event.arguments.userId ?? '').trim();
  const makeAdmin = Boolean(event.arguments.makeAdmin);
  if (!userId) throw new Error('userId is required');

  // Guard against an admin removing their own access and locking everyone out
  // of the admin tools.
  const callerSub = (event.identity as { sub?: string } | null)?.sub;
  if (!makeAdmin && callerSub && callerSub === userId) {
    throw new Error('You cannot remove your own admin access.');
  }

  // Cognito group membership is the real admin gate. The admin APIs accept the
  // user's `sub` (what UserProfile stores as `userId`) as the Username.
  const groupArgs = {
    UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
    Username: userId,
    GroupName: env.ADMIN_GROUP,
  };
  await cognito.send(
    makeAdmin
      ? new AdminAddUserToGroupCommand(groupArgs)
      : new AdminRemoveUserFromGroupCommand(groupArgs),
  );

  // Keep the app-level mirror in sync.
  const client = await getClient();
  const { data: profiles } = await client.models.UserProfile.listUserProfileByUserId({
    userId,
  });
  const profile = profiles?.[0];
  if (profile) {
    await client.models.UserProfile.update({
      id: profile.id,
      role: makeAdmin ? 'admin' : 'user',
    });
  }

  return { userId, role: makeAdmin ? 'admin' : 'user' };
};
