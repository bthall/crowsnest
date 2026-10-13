import Database from 'better-sqlite3';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const etag = value => createHash('sha256').update(value).digest('hex');

/** SQLite-backed subset of the R2 contract used by the shared application. */
export class Storage {
  #scope = new AsyncLocalStorage();
  #tail = Promise.resolve();
  #pending = 0;

  constructor(filename) {
    mkdirSync(dirname(filename), {recursive: true, mode: 0o700});
    this.db = new Database(filename, {timeout: 5000});
    chmodSync(filename, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', {simple: true});
    if (version > 1) throw new Error('Database schema is newer than this server');
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE objects (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT NOT NULL) STRICT;
        CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password TEXT NOT NULL) STRICT;
        CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL) STRICT;
        CREATE INDEX sessions_expiry ON sessions(expires);
        CREATE TABLE bootstrap (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL, expires INTEGER NOT NULL, purpose TEXT NOT NULL) STRICT;
        CREATE TABLE limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL) STRICT;
      `);
      this.db.pragma('user_version = 1');
    })();
    this.statements = {
      get: this.db.prepare('SELECT value, etag FROM objects WHERE key = ?'),
      put: this.db.prepare('INSERT INTO objects(key, value, etag) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, etag=excluded.etag'),
      conditional: this.db.prepare('UPDATE objects SET value=?, etag=? WHERE key=? AND etag=?'),
      delete: this.db.prepare('DELETE FROM objects WHERE key = ?'),
      list: this.db.prepare('SELECT key FROM objects WHERE key >= ? AND key < ? AND key > ? ORDER BY key LIMIT ?'),
    };
  }

  /** Own every async transaction through commit; other callers wait outside it. */
  async run(callback, {atomic = false} = {}) {
    if (this.#scope.getStore() === this) return callback();
    if (this.#pending >= 256) throw new Error('Storage queue is full');
    this.#pending++;
    const result = this.#tail.then(() => this.#scope.run(this, async () => {
      if (atomic) this.db.exec('BEGIN IMMEDIATE');
      try {
        const value = await callback();
        if (atomic) this.db.exec(value instanceof Response && value.status >= 500 ? 'ROLLBACK' : 'COMMIT');
        return value;
      } catch (error) {
        if (atomic && this.db.inTransaction) this.db.exec('ROLLBACK');
        throw error;
      }
    }));
    this.#tail = result.catch(() => {}).finally(() => this.#pending--);
    return result;
  }

  get(key) {
    return this.run(() => {
      const row = this.statements.get.get(key);
      return row ? {etag: row.etag, json: async () => JSON.parse(row.value)} : null;
    });
  }

  put(key, value, options = {}) {
    return this.run(() => {
      const next = etag(value);
      if (options.onlyIf?.etagMatches !== undefined) {
        if (!this.statements.conditional.run(value, next, key, options.onlyIf.etagMatches).changes) return null;
      } else this.statements.put.run(key, value, next);
      return {etag: next};
    });
  }

  delete(key) { return this.run(() => { this.statements.delete.run(key); }); }

  list({prefix = '', cursor = '', limit = 1000} = {}) {
    return this.run(() => {
      if (typeof prefix !== 'string' || typeof cursor !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid storage page');
      const rows = this.statements.list.all(prefix, prefix + '\uffff', cursor, limit + 1);
      const truncated = rows.length > limit;
      const objects = rows.slice(0, limit);
      return {objects, truncated, ...(truncated ? {cursor: objects.at(-1).key} : {})};
    });
  }

  async close() { await this.#tail; this.db.close(); }
}
