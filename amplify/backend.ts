import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { scrapeRace } from './functions/scrape-race/resource.js';

defineBackend({
  auth,
  data,
  scrapeRace,
});
