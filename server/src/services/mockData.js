// Deterministic sample data for the MockRaceProvider so the full app runs without
// Race Monitor credentials. Times are computed relative to "now" so the UI shows a
// realistic mix of scheduled, active, and finished races.

function isoOffset(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function makeDrivers(prefix, names) {
  return names.map((name, i) => ({
    external_id: `${prefix}-D${i + 1}`,
    number: String((i + 1) * 2 + 1),
    name,
    active: true,
  }));
}

const GRID_A = makeDrivers('A', [
  'Alex Stone', 'Maria Cruz', 'Liam Park', 'Noah Reed', 'Emma Frost',
  'Owen Diaz', 'Ava Lin', 'Mason Vale', 'Sofia Ruiz', 'Jack Moon',
]);
const GRID_B = makeDrivers('B', [
  'Ethan Wolfe', 'Olivia Snow', 'Lucas Grey', 'Mia Quinn', 'Henry Vale',
  'Zoe Banks', 'Caleb Fox', 'Nina Hart', 'Ryan Cole', 'Lily Dawn',
]);
const GRID_C = makeDrivers('C', [
  'Marco Bell', 'Ruby Lane', 'Dylan Ash', 'Ivy Stone', 'Felix Kerr',
  'Grace Bond', 'Theo Rivers', 'Hazel Pike', 'Sam Webb', 'Clara Vance',
]);

// finishOrder lists driver external_ids from 1st place to last.
function finishFor(drivers) {
  // Deterministic shuffle: rotate the grid for a stable "result".
  const ids = drivers.map((d) => d.external_id);
  return [...ids.slice(3), ...ids.slice(0, 3)];
}

export const mockRaces = [
  {
    external_id: 'RM-1001',
    name: 'Spring Cup — Round 1',
    series: 'GT Sprint',
    track: 'Riverside International',
    start_time: isoOffset(-72),
    status: 'finished',
    drivers: GRID_A,
    finishOrder: finishFor(GRID_A),
  },
  {
    external_id: 'RM-1002',
    name: 'Midnight Endurance',
    series: 'Endurance Series',
    track: 'Nightfall Speedway',
    start_time: isoOffset(-1),
    status: 'active',
    drivers: GRID_B,
    finishOrder: null,
  },
  {
    external_id: 'RM-1003',
    name: 'Summer Grand Prix',
    series: 'GT Sprint',
    track: 'Sunset Circuit',
    start_time: isoOffset(48),
    status: 'scheduled',
    drivers: GRID_C,
    finishOrder: null,
  },
  {
    external_id: 'RM-1004',
    name: 'Coastal Challenge',
    series: 'Touring Cup',
    track: 'Harborline Raceway',
    start_time: isoOffset(120),
    status: 'scheduled',
    drivers: GRID_A,
    finishOrder: null,
  },
];

// Default F1-style position -> points table (1st .. 10th).
export const defaultScoringRules = [
  { finish_position: 1, points: 25 },
  { finish_position: 2, points: 18 },
  { finish_position: 3, points: 15 },
  { finish_position: 4, points: 12 },
  { finish_position: 5, points: 10 },
  { finish_position: 6, points: 8 },
  { finish_position: 7, points: 6 },
  { finish_position: 8, points: 4 },
  { finish_position: 9, points: 2 },
  { finish_position: 10, points: 1 },
];
