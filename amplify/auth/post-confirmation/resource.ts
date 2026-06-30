import { defineFunction } from '@aws-amplify/backend';

/**
 * Post-confirmation trigger that auto-promotes a configured admin email into the
 * Cognito `Admins` group, so the first admin is bootstrapped reproducibly with
 * no console step. Everyone else signs up as a regular user.
 */
export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './handler.ts',
  environment: {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'eric.pingel@gmail.com',
    ADMIN_GROUP: 'Admins',
  },
});
