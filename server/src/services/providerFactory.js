import { config } from '../config.js';
import { MockRaceProvider } from './MockRaceProvider.js';
import { RaceMonitorProvider } from './RaceMonitorProvider.js';

let provider;

export function getRaceProvider() {
  if (provider) return provider;
  if (config.raceProvider === 'racemonitor') {
    provider = new RaceMonitorProvider();
  } else {
    provider = new MockRaceProvider();
  }
  return provider;
}
