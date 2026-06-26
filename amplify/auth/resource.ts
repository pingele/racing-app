import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-signup/resource.js';

/**
 * Cognito user pool — email + password sign-in with a required `displayName`
 * standard attribute (maps to the legacy `users.display_name` column).
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
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
  triggers: {
    preSignUp,
  },
});
