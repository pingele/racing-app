import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-signup/resource.js';
import { postConfirmation } from './post-confirmation/resource.js';
import { manageAdmin } from '../functions/manage-admin/resource.js';

/**
 * Cognito user pool — email + password sign-in with a required `nickname`
 * (display name). An `Admins` group gates the scrape/import features; the
 * post-confirmation trigger auto-adds the configured admin email to it.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins'],
  userAttributes: {
    preferredUsername: {
      required: false,
      mutable: true,
    },
    nickname: {
      required: true,
      mutable: true,
    },
  },
  access: (allow) => [
    allow.resource(postConfirmation).to(['addUserToGroup']),
    // The admin screen promotes/demotes users by editing `Admins` group
    // membership; this grants that Lambda the group-management APIs plus the
    // `AMPLIFY_AUTH_USERPOOL_ID` env var it needs to target the pool.
    allow.resource(manageAdmin).to(['addUserToGroup', 'removeUserFromGroup']),
  ],
  triggers: {
    preSignUp,
    postConfirmation,
  },
});
