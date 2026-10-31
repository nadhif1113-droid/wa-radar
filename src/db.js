import { DatabaseSync } from 'node:sqlite';   // database bawaan Node.js (tanpa compile)
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
// "2026-10-31T14" (jam lokal) dari timestamp ms
export function hourKey(ts) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

export function openDb(file = env.DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (jid TEXT PRIMARY KEY, name TEXT, mode TEXT DEFAULT 'digest', added INTEGER);
    CREATE TABLE IF NOT EXISTS seen (hash TEXT PRIMARY KEY, count INTEGER, first_ts INTEGER, last_ts INTEGER);
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, group_jid TEXT, group_name TEXT,
      sender_name TEXT, sender_num TEXT, text TEXT, kind TEXT, category TEXT, summary TEXT,
      urgent INTEGER DEFAULT 0, ai_done INTEGER DEFAULT 0, alerted INTEGER DEFAULT 0, digested INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS items_ts ON items(ts);
    CREATE TABLE IF NOT EXISTS stats (bucket TEXT, group_jid TEXT, kind TEXT, n INTEGER, PRIMARY KEY (bucket, group_jid, kind));
    CREATE TABLE IF NOT EXISTS catstats (bucket TEXT, category TEXT, side TEXT, n INTEGER, PRIMARY KEY (bucket, category, side));
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

export const meta = {
  get: (db, k) => db.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v,
  set: (db, k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)),
};

export function bump(db, ts, groupJid, kind) {
  db.prepare(`INSERT INTO stats(bucket,group_jid,kind,n) VALUES(?,?,?,1)
              ON CONFLICT(bucket,group_jid,kind) DO UPDATE SET n=n+1`).run(hourKey(ts), groupJid, kind);
}
export function bumpCat(db, ts, category, side) {
  db.prepare(`INSERT INTO catstats(bucket,category,side,n) VALUES(?,?,?,1)
              ON CONFLICT(bucket,category,side) DO UPDATE SET n=n+1`).run(hourKey(ts), category, side);
}

// Bersih-bersih: hapus data lama supaya database tetap kecil
export function prune(db, now = Date.now()) {
  const cutoff = now - env.RETAIN_DAYS * 864e5;
  const cutKey = hourKey(cutoff);
  db.prepare('DELETE FROM items WHERE ts < ?').run(cutoff);
  db.prepare('DELETE FROM seen WHERE last_ts < ?').run(now - 14 * 864e5);
  db.prepare('DELETE FROM stats WHERE bucket < ?').run(cutKey);
  db.prepare('DELETE FROM catstats WHERE bucket < ?').run(hourKey(now - 90 * 864e5));
  db.exec('VACUUM');
}
