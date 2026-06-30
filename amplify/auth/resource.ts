import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-signup/resource.js';
import { postConfirmation } from './post-confirmation/resource.js';

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
  ],
  triggers: {
    preSignUp,
    postConfirmation,
  },
});
