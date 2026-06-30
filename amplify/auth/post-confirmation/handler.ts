import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { env } from '$amplify/env/post-confirmation';

const client = new CognitoIdentityProviderClient();

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email?.toLowerCase();
  if (email && email === env.ADMIN_EMAIL.toLowerCase()) {
    await client.send(
      new AdminAddUserToGroupCommand({
        GroupName: env.ADMIN_GROUP,
        Username: event.userName,
        UserPoolId: event.userPoolId,
      }),
    );
  }
  return event;
};
