// Alur tiap pesan masuk: buang yang gak penting secepat mungkin, simpan sisanya.
import { ruleKind, textHash, categorize, isUrgent } from './classify.js';
import { bump, bumpCat } from './db.js';

export function ensureGroup(db, jid, name, ts = Date.now()) {
  db.prepare(`INSERT INTO groups(jid,name,mode,added) VALUES(?,?,'digest',?)
              ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name, groups.name)`).run(jid, name ?? null, ts);
  return db.prepare('SELECT * FROM groups WHERE jid=?').get(jid);
}

/**
 * m = { ts, groupJid, groupName, senderName, senderNum, text, hasMedia }
 * Return item tersimpan (tanya/info) atau null kalau dibuang.
 */
export function processMessage(db, m) {
  const g = ensureGroup(db, m.groupJid, m.groupName, m.ts);
  bump(db, m.ts, m.groupJid, 'total');
  if (g.mode === 'ignore') return null;

  const kind = ruleKind(m.text, m.hasMedia);
  if (kind === 'media' || kind === 'kosong') { bump(db, m.ts, m.groupJid, kind); return null; }

  // Copy-paste berulang? (pesan sama pernah muncul di group mana pun dalam 14 hari)
  const h = textHash(m.text);
  const prev = db.prepare('SELECT count FROM seen WHERE hash=?').get(h);
  db.prepare(`INSERT INTO seen(hash,count,first_ts,last_ts) VALUES(?,1,?,?)
              ON CONFLICT(hash) DO UPDATE SET count=count+1, last_ts=excluded.last_ts`).run(h, m.ts, m.ts);
  if (prev) { bump(db, m.ts, m.groupJid, 'ulang'); return null; }

  const category = categorize(m.text);
  bump(db, m.ts, m.groupJid, kind);
  if (kind === 'iklan') { bumpCat(db, m.ts, category, 'supply'); return null; }
  if (kind === 'lain') return null;
  if (kind === 'tanya') bumpCat(db, m.ts, category, 'demand');

  const info = db.prepare(`INSERT INTO items(ts,group_jid,group_name,sender_name,sender_num,text,kind,category,urgent)
                           VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(m.ts, m.groupJid, g.name || m.groupName, m.senderName || '', m.senderNum || '', m.text.slice(0, 1500), kind, category,
      isUrgent(m.text) ? 1 : 0);
  return db.prepare('SELECT * FROM items WHERE id=?').get(info.lastInsertRowid);
}
