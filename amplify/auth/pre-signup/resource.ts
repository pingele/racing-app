import { defineFunction } from '@aws-amplify/backend';

/**
 * Pre-signUp trigger that auto-confirms users and auto-verifies email so the
 * existing Login/Register UX in the React app works with no email-code step.
 *
 * Remove this trigger if you'd prefer to enforce email verification.
 */
export const preSignUp = defineFunction({
  name: 'pre-signup-autoconfirm',
  entry: './handler.ts',
});
