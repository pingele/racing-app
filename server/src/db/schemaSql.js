export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS races (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    series      TEXT,
    track       TEXT,
    start_time  TEXT,
    status      TEXT NOT NULL DEFAULT 'scheduled',
    synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id     INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    number      TEXT,
    name        TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE(race_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS race_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id         INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    driver_id       INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    finish_position INTEGER NOT NULL,
    status          TEXT,
    laps            INTEGER,
    best_lap_time   TEXT,
    last_lap_time   TEXT,
    total_time      TEXT,
    UNIQUE(race_id, driver_id)
  );

  CREATE TABLE IF NOT EXISTS picks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    race_id        INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    driver_id      INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    points_awarded INTEGER,
    scored_at      TEXT,
    UNIQUE(user_id, race_id)
  );

  CREATE TABLE IF NOT EXISTS scoring_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    finish_position INTEGER NOT NULL UNIQUE,
    points          INTEGER NOT NULL
  );
`;
