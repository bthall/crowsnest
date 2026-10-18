import Database from 'better-sqlite3';

export const schemaVersion = 1;
export const schemaSql = `
  CREATE TABLE objects (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT NOT NULL) STRICT;
  CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password TEXT NOT NULL) STRICT;
  CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL) STRICT;
  CREATE INDEX sessions_expiry ON sessions(expires);
  CREATE TABLE bootstrap (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL, expires INTEGER NOT NULL, purpose TEXT NOT NULL) STRICT;
  CREATE TABLE limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL) STRICT;
`;

// Compare the complete application-owned schema, including constraints and any
// unexpected triggers/views, before executing writes against a restored file.
function definitions(db) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name").all()
    .map(row => ({...row, sql: row.sql?.replace(/\s+/g, ' ').trim()}));
}

export function validateBackup(db) {
  if (db.pragma('user_version', {simple: true}) !== schemaVersion || db.pragma('integrity_check', {simple: true}) !== 'ok') throw new Error('Backup is invalid or uses an unsupported schema');
  const expected = new Database(':memory:');
  try {
    expected.exec(schemaSql);
    if (JSON.stringify(definitions(db)) !== JSON.stringify(definitions(expected))) throw new Error('Backup schema does not match Crowsnest');
  } finally { expected.close(); }
}
