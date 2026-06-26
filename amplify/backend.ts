import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { syncRaces } from './functions/sync-races/resource.js';

defineBackend({
  auth,
  data,
  syncRaces,
});
