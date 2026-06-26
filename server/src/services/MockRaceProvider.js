import { RaceProvider } from './RaceProvider.js';
import { mockRaces } from './mockData.js';

function toRace(r) {
  return {
    external_id: r.external_id,
    name: r.name,
    series: r.series,
    track: r.track,
    start_time: r.start_time,
    status: r.status,
  };
}

export class MockRaceProvider extends RaceProvider {
  async listRaces() {
    return mockRaces.map(toRace);
  }

  async getRace(externalId) {
    const r = mockRaces.find((x) => x.external_id === externalId);
    return r ? toRace(r) : null;
  }

  async getDrivers(externalId) {
    const r = mockRaces.find((x) => x.external_id === externalId);
    if (!r) return [];
    return r.drivers.map((d) => ({ ...d }));
  }

  async getResults(externalId) {
    const r = mockRaces.find((x) => x.external_id === externalId);
    if (!r || r.status !== 'finished' || !r.finishOrder) return null;
    return r.finishOrder.map((driverExtId, idx) => ({
      driver_external_id: driverExtId,
      finish_position: idx + 1,
      status: 'Classified',
    }));
  }
}
