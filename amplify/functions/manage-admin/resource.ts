import { defineFunction } from '@aws-amplify/backend';

/**
 * On-demand Lambda that grants or revokes admin access for an existing user.
 * Backs the `setAdminRole` custom mutation (see `amplify/data/resource.ts`),
 * which is gated to the `Admins` group.
 *
 * Admin gating is Cognito-group based, so promoting a user means adding them to
 * the `Admins` group — an admin API the browser can't call. The handler does
 * that (mirroring the post-confirmation bootstrap) and keeps the app-level
 * `UserProfile.role` mirror in sync. The user pool id is injected as
 * `AMPLIFY_AUTH_USERPOOL_ID` by the auth-access grant in `amplify/auth/resource.ts`.
 */
export const manageAdmin = defineFunction({
  name: 'manage-admin',
  entry: './handler.ts',
  environment: {
    ADMIN_GROUP: 'Admins',
  },
});
