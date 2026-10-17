import {createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCallback);
const sessionDuration = 8 * 60 * 60 * 1000;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const secret = () => randomBytes(32).toString('base64url');
const parameters = {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024};
const validPassword = password => typeof password === 'string' && password.length >= 12 && password.length <= 128 && Buffer.byteLength(password) <= 512;
const validUsername = username => typeof username === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9.@_-]{2,63}$/.test(username);

export class Authentication {
  #hashing = 0;

  constructor(storage, origin) {
    this.storage = storage;
    this.secure = new URL(origin).protocol === 'https:';
    this.cookieName = this.secure ? '__Host-crowsnest' : 'crowsnest_local';
    this.dummy = 'scrypt$' + randomBytes(16).toString('hex') + '$' + randomBytes(64).toString('hex');
  }

  state() { return this.storage.run(() => ({setupRequired: !this.storage.db.prepare('SELECT id FROM owner').get()})); }

  issueCode(purpose = 'setup') {
    return this.storage.run(() => {
      const owner = this.storage.db.prepare('SELECT id FROM owner').get();
      if ((purpose === 'setup' && owner) || (purpose === 'reset' && !owner) || !['setup', 'reset'].includes(purpose)) throw new Error('Use setup-token for a new instance or reset-token for an existing owner');
      const code = secret();
      this.storage.db.prepare('INSERT INTO bootstrap VALUES(1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, expires=excluded.expires, purpose=excluded.purpose').run(hashToken(code), Date.now() + 15 * 60000, purpose);
      return code;
    });
  }

  async #derive(password, salt) {
    if (this.#hashing >= 2) throw Object.assign(new Error('Sign-in is busy. Try again shortly.'), {status: 429});
    this.#hashing++;
    try { return await scrypt(password, salt, 64, parameters); }
    finally { this.#hashing--; }
  }

  async #passwordHash(password) {
    const salt = randomBytes(16).toString('hex');
    return 'scrypt$' + salt + '$' + (await this.#derive(password, salt)).toString('hex');
  }

  async #verify(password, stored) {
    const [scheme, salt, hex] = stored.split('$');
    if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) throw new Error('Invalid stored password');
    return timingSafeEqual(await this.#derive(password, salt), Buffer.from(hex, 'hex'));
  }

  async #limit(address) {
    return this.storage.run(() => {
      const now = Date.now();
      this.storage.db.prepare('DELETE FROM limits WHERE start < ?').run(now - 5 * 60000);
      for (const [key, maximum] of [['global', 100], ['ip:' + hashToken(address || 'unknown'), 10]]) {
        this.storage.db.prepare('INSERT INTO limits VALUES(?, ?, 1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now);
        if (this.storage.db.prepare('SELECT count FROM limits WHERE key=?').get(key).count > maximum) throw Object.assign(new Error('Too many attempts. Try again in five minutes.'), {status: 429});
      }
    });
  }

  async enroll(data, address) {
    await this.#limit(address);
    if (!validUsername(data.username) || !validPassword(data.password) || typeof data.code !== 'string' || data.code.length > 128) throw Object.assign(new Error('Enter the code, a username of 3–64 characters, and a password of 12–128 characters.'), {status: 400});
    const purpose = data.recovery === true ? 'reset' : 'setup';
    const eligible = await this.storage.run(() => {
      const row = this.storage.db.prepare('SELECT * FROM bootstrap WHERE id=1').get();
      const owner = this.storage.db.prepare('SELECT username FROM owner').get();
      return !!row && safeEqual(row.hash, hashToken(data.code)) && row.expires > Date.now() && row.purpose === purpose && (purpose === 'setup' ? !owner : owner?.username === data.username);
    });
    if (!eligible) throw Object.assign(new Error('The code is invalid or expired. Generate a new code on the server.'), {status: 403});
    const password = await this.#passwordHash(data.password);
    return this.storage.run(() => {
      const row = this.storage.db.prepare('SELECT * FROM bootstrap WHERE id=1').get();
      if (!row || !safeEqual(row.hash, hashToken(data.code)) || row.expires <= Date.now() || row.purpose !== purpose) throw Object.assign(new Error('The code is invalid or expired.'), {status: 403});
      this.storage.db.prepare('INSERT INTO owner VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET password=excluded.password').run(data.username, password);
      this.storage.db.prepare('DELETE FROM bootstrap').run();
      this.storage.db.prepare('DELETE FROM sessions').run();
      return this.#newSession();
    }, {atomic: true});
  }

  async login(data, address) {
    await this.#limit(address);
    if (!validUsername(data.username) || typeof data.password !== 'string' || data.password.length > 128 || Buffer.byteLength(data.password) > 512) throw Object.assign(new Error('Check your username and password.'), {status: 401});
    const owner = await this.storage.run(() => this.storage.db.prepare('SELECT * FROM owner').get());
    const match = owner?.username === data.username;
    const correct = await this.#verify(data.password, match ? owner.password : this.dummy);
    if (!match || !correct) throw Object.assign(new Error('Check your username and password.'), {status: 401});
    return this.storage.run(() => {
      // A recovery that finished during hashing invalidates the old password.
      if (this.storage.db.prepare('SELECT password FROM owner').get()?.password !== owner.password) throw Object.assign(new Error('Check your username and password.'), {status: 401});
      return this.#newSession();
    });
  }

  #newSession() {
    const token = secret();
    this.storage.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    // Bound storage even if the owner signs in repeatedly.
    this.storage.db.prepare('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions ORDER BY expires DESC LIMIT -1 OFFSET 19)').run();
    this.storage.db.prepare('INSERT INTO sessions VALUES(?, ?)').run(hashToken(token), Date.now() + sessionDuration);
    return this.#cookie(token, sessionDuration / 1000);
  }

  #token(cookie) {
    const entries = (cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(this.cookieName + '='));
    if (entries.length !== 1) return null;
    const token = entries[0].slice(this.cookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  }

  authenticated(cookie) {
    const token = this.#token(cookie);
    return this.storage.run(() => !!token && !!this.storage.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hashToken(token), Date.now()));
  }

  logout(cookie) {
    const token = this.#token(cookie);
    return this.storage.run(() => {
      if (token) this.storage.db.prepare('DELETE FROM sessions WHERE hash=?').run(hashToken(token));
      return this.#cookie('', 0);
    });
  }

  #cookie(token, age) { return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${this.secure ? '; Secure' : ''}`; }
}
