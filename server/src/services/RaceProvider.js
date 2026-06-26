// RaceProvider interface (documented contract).
// Implementations must return plain objects matching these shapes.
//
//   listRaces()        -> Promise<Race[]>
//   getRace(extId)     -> Promise<Race | null>
//   getDrivers(extId)  -> Promise<Driver[]>
//   getResults(extId)  -> Promise<Result[] | null>   // null if race not finished
//   getCalendar()      -> Promise<Race[]>            // calendar view (may equal listRaces)
//
// Race   = { external_id, name, series, track, start_time, status }
// Driver = { external_id, number, name, active }
// Result = { driver_external_id, finish_position, status }

export class RaceProvider {
  // eslint-disable-next-line no-unused-vars
  async listRaces() {
    throw new Error('listRaces() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async getRace(externalId) {
    throw new Error('getRace() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async getDrivers(externalId) {
    throw new Error('getDrivers() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async getResults(externalId) {
    throw new Error('getResults() not implemented');
  }

  // Optional: list selectable timing sessions (classes/heats) for a race.
  // Default implementation returns no alternates.
  // eslint-disable-next-line no-unused-vars
  async getSessions(externalId) {
    return [];
  }

  // Optional: fetch a fully-resolved results table for a specific session
  // (each row already has driver number + name + timing fields).
  // eslint-disable-next-line no-unused-vars
  async getSessionResults(externalId, sessionId) {
    return null;
  }

  async getCalendar() {
    return this.listRaces();
  }
}
