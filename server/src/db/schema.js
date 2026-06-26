import db from './connection.js';
import { SCHEMA_SQL } from './schemaSql.js';

// Schema is also bootstrapped in connection.js; this remains for explicit callers.
export function createSchema() {
  db.exec(SCHEMA_SQL);
}

export default createSchema;
