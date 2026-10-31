// ============================================================
//  RADAR GROUP — bot WhatsApp pemantau group (HANYA MEMBACA)
//  Bot tidak pernah mengirim apa pun ke group. Semua hasil dikirim ke WA utama lu.
// ============================================================
import makeWASocket, {
  useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore,
  DisconnectReason, Browsers, isJidGroup, generateMessageIDV2,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import { env } from './config.js';
import { openDb, meta, prune } from './db.js';
import { processMessage, ensureGroup } from './pipeline.js';
import { refinePending, aiEnabled } from './ai.js';
import { buildAlert, buildDigest, buildTrend, buildGroups, buildLeads, buildSearch, listGroups, MENU } from './report.js';
import { CATEGORIES } from './config.js';
import { respond, replyAvailable, initResponderDb } from './responder.js';

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
if (!env.OWNER_NUMBER) { console.error('❌ Isi OWNER_NUMBER di file .env dulu (nomor WA utama lu, contoh 9665xxxxxxx)'); process.exit(1); }

const db = openDb();
initResponderDb(db);
const MINE = new Set(CATEGORIES.filter(c => c.mine).map(c => c.id));
const digits = j => (j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let sock = null;
let pairingRequested = false;
let retries = 0;
let PAIR_DONE = false;
const PAIR_ONLY = process.argv.includes('--pair');

// Nomor bot = nomor utama lu (1 nomor)? Perintah diketik di chat "ke diri sendiri".
const SELF = !!env.BOT_NUMBER && env.BOT_NUMBER === env.OWNER_NUMBER;
const handled = new Set();
const isCommand = t => /^[!/.]?\s*(menu|help|bantuan|status|digest|leads?|trend|tren|grup|groups?|chat|autoreply\s+(on|off)|mode\s+\d+\s+\w+|cari\s+.+)\s*$/i.test((t || '').trim());
function isSelfChat(jid, alt) {
  const mine = [env.BOT_NUMBER, digits(sock?.user?.id), digits(sock?.user?.lid)].filter(Boolean);
  return [jid, alt].some(j => j && mine.includes(digits(j)));
}

// Sembunyikan log teknis enkripsi WA yang bikin layar penuh ("Closing session…")
const NOISE = /^(Closing session|Closing open session|Removing old closed session|Decrypted message with closed session|Session error|Failed to decrypt message)/;
for (const k of ['log', 'info', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (typeof a[0] === 'string' && NOISE.test(a[0])) return; orig(...a); };
}
if (PAIR_ONLY) setTimeout(() => {                         // kode pairing gak dimasukkan dalam 4 menit
  if (PAIR_DONE) return;
  console.log('\n⏰ Waktu habis, kode pairing kedaluwarsa. Jalankan ulang perintah install untuk dapat kode baru.');
  process.exit(1);
}, 4 * 60_000).unref?.();

// ---------- kirim ke WA utama lu ----------
function ownerJid() { return meta.get(db, 'owner_jid') || `${env.OWNER_NUMBER}@s.whatsapp.net`; }
async function toOwner(text) {
  if (!sock) return;
  try { await sock.sendMessage(ownerJid(), { text }); await sleep(1200); }
  catch (e) { log('Gagal kirim ke owner:', e.message); }
}

// ---------- ambil teks dari pesan WA ----------
function unwrap(m) {
  if (!m) return m;
  return m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
         m.documentWithCaptionMessage?.message || m.editedMessage?.message || m;
}
function extract(msg) {
  const m = unwrap(msg.message);
  if (!m || m.protocolMessage || m.reactionMessage || m.pollUpdateMessage) return null;
  const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption ||
               m.documentMessage?.caption || '';
  const hasMedia = !!(m.imageMessage || m.videoMessage || m.stickerMessage || m.documentMessage || m.audioMessage);
  return { text, hasMedia };
}

// ---------- perintah dari lu (chat pribadi ke nomor bot) ----------
async function handleCommand(jid, raw) {
  const t = raw.trim().replace(/^[!/.]/, '');
  const [cmd, ...rest] = t.split(/\s+/);
  const c = cmd.toLowerCase();
  meta.set(db, 'owner_jid', jid);                       // balas ke chat yang lu pakai
  if (['menu', 'help', 'bantuan'].includes(c)) return toOwner(MENU);
  if (c === 'status') {
    const n = listGroups(db).length;
    const ar = !replyAvailable ? 'mati (API key belum diisi)' : autoReplyOn() ? `nyala (${env.REPLY_HOURS})` : 'dimatikan';
    return toOwner(`✅ Bot hidup. Memantau ${n} group.\nAI saringan: ${aiEnabled ? 'nyala' : 'mati (aturan saja)'}\nAuto-reply chat: ${ar}`);
  }
  if (c === 'autoreply') {
    const on = (rest[0] || '').toLowerCase() === 'on';
    meta.set(db, 'autoreply', on ? 'on' : 'off');
    return toOwner(on ? (replyAvailable ? '✅ Auto-reply chat customer NYALA.' : '⚠️ Disimpan, tapi API key Claude belum diisi, jadi belum bisa balas.')
                      : '⏸️ Auto-reply chat customer DIMATIKAN. Chat masuk tetap gw teruskan ke lu.');
  }
  if (c === 'chat') return toOwner(buildChats());
  if (c === 'digest') return sendDigest(true);
  if (c === 'leads' || c === 'lead') return toOwner(buildLeads(db));
  if (c === 'trend' || c === 'tren') return toOwner(buildTrend(db));
  if (c === 'grup' || c === 'group' || c === 'groups') return toOwner(buildGroups(db));
  if (c === 'cari' && rest.length) return toOwner(buildSearch(db, rest.join(' ')));
  if (c === 'mode') {
    const [no, mode] = rest;
    const g = listGroups(db).find(x => String(x.no) === no);
    if (!g || !['alert', 'digest', 'ignore'].includes((mode || '').toLowerCase()))
      return toOwner('Format: *mode <nomor> <alert|digest|ignore>*. Ketik *grup* untuk lihat nomor.');
    db.prepare('UPDATE groups SET mode=? WHERE jid=?').run(mode.toLowerCase(), g.jid);
    return toOwner(`✅ ${g.name} → ${mode.toLowerCase()}`);
  }
  return toOwner('Perintah gak dikenal. Ketik *menu*.');
}

// ---------- auto-reply chat customer ----------
const botSent = new Set();                 // id pesan yang dikirim bot (bukan diketik manusia)
const timers = new Map();                  // jeda tunggu per chat (customer sering kirim beberapa pesan beruntun)
const lastKey = new Map();
const busy = new Set();                    // 1 chat diproses satu-satu
const autoReplyOn = () => replyAvailable && env.AUTO_REPLY && meta.get(db, 'autoreply') !== 'off';
const dayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE }).format(new Date());
function inReplyHours() {
  const [a, b] = env.REPLY_HOURS.split('-').map(x => x.trim());
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: env.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const now = `${p.hour}:${p.minute}`;
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
async function sendAsBot(jid, text) {
  const id = generateMessageIDV2(sock.user?.id);
  botSent.add(id);
  await sock.sendMessage(jid, { text }, { messageId: id });
}
const fmtNum = n => n ? `+${n}` : '(nomor disembunyikan)';
function chatLinkFor(num) { return num ? `https://wa.me/${num}` : ''; }

async function onPrivateMessage(msg, jid, ex) {
  const ts = Number(msg.messageTimestamp) * 1000 || Date.now();
  if (Date.now() - ts > 10 * 60_000) return;              // pesan lama (habis reconnect) gak dibalas
  let num = digits([jid, msg.key.remoteJidAlt].find(j => j && j.endsWith('@s.whatsapp.net')));
  if (!num && jid.endsWith('@lid')) { try { num = digits(await sock.signalRepository?.lidMapping?.getPNForLID(jid)); } catch {} }
  const m = unwrap(msg.message) || {};
  let text = ex.text;
  if (!text && m.audioMessage) text = '[Customer mengirim voice note — kamu tidak bisa mendengarnya, minta tolong ditulis]';
  else if (!text && ex.hasMedia) text = '[Customer mengirim gambar/file tanpa keterangan]';
  if (!text) return;
  db.prepare(`INSERT INTO chats(jid,name,num,last_ts) VALUES(?,?,?,?)
              ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,chats.name), num=COALESCE(NULLIF(excluded.num,''),chats.num), last_ts=excluded.last_ts`)
    .run(jid, msg.pushName || null, num || '', ts);
  db.prepare('INSERT INTO convo(jid,role,text,ts) VALUES(?,?,?,?)').run(jid, 'user', text.slice(0, 2000), ts);
  lastKey.set(jid, msg.key);
  clearTimeout(timers.get(jid));
  schedule(jid, 12_000);
}

function schedule(jid, ms) {
  clearTimeout(timers.get(jid));
  timers.set(jid, setTimeout(async () => {
    if (busy.has(jid)) return schedule(jid, 4000);         // masih ngetik balasan sebelumnya → tunggu
    busy.add(jid);
    try { await processChat(jid); } catch (e) { log('Auto-reply error:', e.message); }
    finally { busy.delete(jid); }
  }, ms));
}

async function processChat(jid) {
  timers.delete(jid);
  const chat = db.prepare('SELECT * FROM chats WHERE jid=?').get(jid);
  if (!chat) return;
  const now = Date.now();
  const who = `${chat.name || 'Tanpa nama'} · ${fmtNum(chat.num)}`;
  const lastUser = db.prepare(`SELECT text FROM convo WHERE jid=? AND role='user' ORDER BY id DESC LIMIT 1`).get(jid)?.text || '';

  if (chat.paused_until > now) return;                     // lu lagi pegang chat ini manual
  if (!autoReplyOn() || !inReplyHours()) {                 // auto-reply mati / di luar jam → cukup teruskan
    if (now - (chat.last_hold_at || 0) > 30 * 60_000) {
      db.prepare('UPDATE chats SET last_hold_at=? WHERE jid=?').run(now, jid);
      await toOwner(`💬 *Chat masuk* (belum dibalas bot)\n👤 ${who}\n"${lastUser.slice(0, 300)}"\n${chatLinkFor(chat.num)}`);
    }
    return;
  }
  if (chat.handoff_at && now - chat.handoff_at < 12 * 36e5) {   // udah diteruskan ke lu → bot nahan diri
    await toOwner(`💬 *Pesan baru* dari customer yang udah diteruskan (${chat.business || '-'})\n👤 ${who}\n"${lastUser.slice(0, 300)}"\n${chatLinkFor(chat.num)}`);
    if (now - (chat.last_hold_at || 0) > 2 * 36e5) {
      db.prepare('UPDATE chats SET last_hold_at=? WHERE jid=?').run(now, jid);
      const hold = 'Baik, pesan Bapak/Ibu sudah kami teruskan ke admin. Mohon ditunggu sebentar ya 🙏';
      await sendAsBot(jid, hold);
      db.prepare('INSERT INTO convo(jid,role,text,ts) VALUES(?,?,?,?)').run(jid, 'assistant', hold, Date.now());
    }
    return;
  }
  const today = dayStr();
  const used = chat.day_key === today ? chat.day_replies : 0;
  if (used >= env.REPLY_MAX_PER_CHAT_DAY) {
    db.prepare('UPDATE chats SET paused_until=? WHERE jid=?').run(now + 12 * 36e5, jid);
    return toOwner(`⚠️ Bot berhenti balas ${who} (udah ${used} balasan hari ini). Tolong lanjutkan manual.\n${chatLinkFor(chat.num)}`);
  }

  const history = db.prepare(`SELECT role, text, ts FROM convo WHERE jid=? AND ts > ? ORDER BY ts DESC, id DESC LIMIT 24`)
    .all(jid, now - 7 * 864e5).reverse();
  const answeredTs = Math.max(0, ...history.filter(h => h.role === 'user').map(h => h.ts)) + 1;
  let r;
  try { r = await respond(history); }
  catch (e) {
    log('Claude gagal:', e.message);
    return toOwner(`⚠️ Bot gagal balas (${e.message.slice(0, 80)}). Tolong balas manual:\n👤 ${who}\n"${lastUser.slice(0, 300)}"\n${chatLinkFor(chat.num)}`);
  }
  if (!r) return;
  if (r.reply) {
    try { const k = lastKey.get(jid); if (k) await sock.readMessages([k]); } catch {}
    try { await sock.sendPresenceUpdate('composing', jid); } catch {}
    await sleep(Math.min(9000, 2500 + r.reply.length * 35));   // jeda "lagi ngetik" biar natural
    await sendAsBot(jid, r.reply);
    try { await sock.sendPresenceUpdate('paused', jid); } catch {}
    db.prepare('INSERT INTO convo(jid,role,text,ts) VALUES(?,?,?,?)').run(jid, 'assistant', r.reply, answeredTs);
  }
  db.prepare('UPDATE chats SET business=?, summary=?, day_key=?, day_replies=? WHERE jid=?')
    .run(r.business, r.summary, today, used + (r.reply ? 1 : 0), jid);
  if (r.handoff) {
    db.prepare('UPDATE chats SET handoff_at=? WHERE jid=?').run(Date.now(), jid);
    await toOwner(`🤝 *CUSTOMER SIAP DILAYANI — ${r.business}*\n\n${r.summary}\n\n👤 ${who}\n` +
      (chat.num ? `💬 ${chatLinkFor(chat.num)}\n` : '') +
      `_Bot berhenti balas chat ini 12 jam. Lanjutkan dari HP nomor bisnis._`);
  }
}

function buildChats() {
  const rows = db.prepare('SELECT * FROM chats WHERE last_ts > ? ORDER BY last_ts DESC LIMIT 25').all(Date.now() - 3 * 864e5);
  if (!rows.length) return 'Belum ada chat customer dalam 3 hari terakhir.';
  const byBiz = {};
  for (const r of rows) (byBiz[r.business || 'Belum jelas'] ||= []).push(r);
  const out = [`💬 *CHAT CUSTOMER 3 HARI* (${rows.length})`];
  for (const [biz, list] of Object.entries(byBiz)) {
    out.push('', `*${biz}* (${list.length})`);
    for (const r of list) {
      const st = r.paused_until > Date.now() ? '✋ manual' : r.handoff_at ? '🤝 diteruskan' : '🤖 bot';
      out.push(`• ${r.name || 'Tanpa nama'} ${fmtNum(r.num)} · ${st}`, `   ${(r.summary || '').slice(0, 140)}`);
    }
  }
  return out.join('\n');
}

// ---------- alert real-time ----------
async function flushQueue() {
  try {
    await refinePending(db, { warn: log });
    const items = db.prepare(`SELECT i.*, g.mode FROM items i JOIN groups g ON g.jid=i.group_jid
                              WHERE i.alerted=0 AND i.ai_done=1 AND i.ts > ? ORDER BY i.ts`).all(Date.now() - 6 * 36e5);
    let sent = 0;
    for (const it of items) {
      const want = (it.mode === 'alert' && (it.kind === 'tanya' || it.kind === 'info')) ||
                   (env.ALERT_MINE && it.kind === 'tanya' && MINE.has(it.category));
      db.prepare('UPDATE items SET alerted=1 WHERE id=?').run(it.id);
      if (!want || sent >= 10) continue;                   // sisanya masuk digest
      await toOwner(buildAlert(it)); sent++;
    }
  } catch (e) { log('flushQueue error:', e.message); }
}

async function sendDigest(manual = false) {
  const last = Number(meta.get(db, 'last_digest_ts')) || Date.now() - 12 * 36e5;
  await toOwner(buildDigest(db, { sinceTs: last }));
  meta.set(db, 'last_digest_ts', Date.now());
  if (!manual) log('Digest terkirim');
}

// ---------- koneksi WhatsApp ----------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const logger = pino({ level: 'silent' });
  sock = makeWASocket({
    version, logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,          // gak kelihatan "online"
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async () => undefined,
  });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered) {
      if (env.BOT_NUMBER && !pairingRequested) {
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(env.BOT_NUMBER);
          console.log(`\n🔑 KODE PAIRING: ${code.match(/.{1,4}/g).join('-')}\n` +
            `   Di HP nomor kedua: WhatsApp → Perangkat tertaut → Tautkan perangkat → "Tautkan dengan nomor telepon" → masukkan kode.\n`);
        } catch (e) { console.log('Gagal minta kode pairing, pakai QR di bawah:', e.message); qrcode.generate(qr, { small: true }); }
      } else if (!env.BOT_NUMBER) {
        console.log('\nScan QR ini dari HP nomor kedua (WhatsApp → Perangkat tertaut → Tautkan perangkat):');
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      retries = 0;
      log('✅ Tersambung ke WhatsApp');
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const g of Object.values(groups)) ensureGroup(db, g.id, g.subject);
        log(`Memantau ${Object.keys(groups).length} group`);
        if (!meta.get(db, 'welcomed')) {
          meta.set(db, 'welcomed', 1);
          meta.set(db, 'last_digest_ts', Date.now());
          await toOwner(`✅ *Radar Group aktif!*\nMemantau ${Object.keys(groups).length} group.\n\n${MENU}`);
        }
      } catch (e) { log('Gagal ambil daftar group:', e.message); }
      if (PAIR_ONLY) {                                     // mode setup: selesai pairing → keluar sendiri
        log('✅ Pairing berhasil. Cek WA utama lu, harusnya ada pesan "Radar Group aktif".');
        PAIR_DONE = true;
        setTimeout(() => process.exit(0), 8000);
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('❌ Logout dari WhatsApp. Hapus folder "auth" lalu jalankan ulang untuk pairing lagi.');
        process.exit(1);
      }
      const wait = Math.min(300, 5 * 2 ** retries++);      // 5s, 10s, 20s … maks 5 menit
      log(`Koneksi putus (${code}), sambung ulang ${wait} detik lagi…`);
      setTimeout(start, wait * 1000);
    }
  });

  sock.ev.on('groups.update', ups => {
    for (const u of ups) if (u.id && u.subject) ensureGroup(db, u.id, u.subject);
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;
      const ex = extract(msg);
      if (!ex) continue;

      // Mode 1 nomor: lu ngetik perintah di "Chat ke diri sendiri" (Message yourself)
      if (SELF && msg.key.fromMe && !isJidGroup(jid) && isSelfChat(jid, msg.key.remoteJidAlt) && isCommand(ex.text)) {
        if (handled.has(msg.key.id)) continue;
        handled.add(msg.key.id);
        await handleCommand(jid, ex.text);
        continue;
      }
      if (type !== 'notify') continue;                   // selain itu: hanya pesan baru, bukan riwayat

      // Lu bales manual dari HP nomor bisnis → bot minggir 24 jam di chat itu
      if (msg.key.fromMe && !isJidGroup(jid) && !botSent.has(msg.key.id) && !isSelfChat(jid, msg.key.remoteJidAlt)) {
        db.prepare(`INSERT INTO chats(jid,paused_until,last_ts) VALUES(?,?,?)
                    ON CONFLICT(jid) DO UPDATE SET paused_until=excluded.paused_until`).run(jid, Date.now() + 24 * 36e5, Date.now());
        db.prepare('INSERT INTO convo(jid,role,text,ts) VALUES(?,?,?,?)').run(jid, 'assistant', ex.text || '[admin]', Date.now());
        continue;
      }

      if (isJidGroup(jid)) {
        if (msg.key.fromMe) continue;
        // Cari nomor asli pengirim (WA sering menyamarkan jadi "LID")
        const parts = [msg.key.participant, msg.key.participantAlt].filter(Boolean);
        let senderNum = digits(parts.find(j => j.endsWith('@s.whatsapp.net')));
        const lid = parts.find(j => j.endsWith('@lid'));
        if (!senderNum && lid) {
          try { senderNum = digits(await sock.signalRepository?.lidMapping?.getPNForLID(lid)); } catch {}
        }
        let groupName = db.prepare('SELECT name FROM groups WHERE jid=?').get(jid)?.name;
        if (!groupName) { try { groupName = (await sock.groupMetadata(jid)).subject; } catch { groupName = jid; } }
        processMessage(db, {
          ts: Number(msg.messageTimestamp) * 1000 || Date.now(), groupJid: jid, groupName,
          senderName: msg.pushName || '', senderNum, text: ex.text, hasMedia: ex.hasMedia,
        });
        continue;
      }

      // chat pribadi dari nomor utama lu = perintah
      const fromOwner = [jid, msg.key.remoteJidAlt].some(j => digits(j) === env.OWNER_NUMBER);
      if (fromOwner) { if (!msg.key.fromMe && ex.text) await handleCommand(jid, ex.text); continue; }

      // chat pribadi lain = calon customer → auto-reply
      if (msg.key.fromMe || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) continue;
      await onPrivateMessage(msg, jid, ex);
    }
  });
}

// ---------- jadwal ----------
setInterval(flushQueue, 60_000);                            // cek lead tiap 1 menit
for (const t of env.DIGEST_TIMES) {
  const [h, m] = t.split(':').map(Number);
  cron.schedule(`${m} ${h} * * *`, () => sendDigest(), { timezone: env.TIMEZONE });
}
cron.schedule('30 3 * * *', () => { prune(db); log('Database dibersihkan'); }, { timezone: env.TIMEZONE });

log(`Radar Group start · AI ${aiEnabled ? 'NYALA (' + env.CLAUDE_MODEL + ')' : 'MATI'} · digest ${env.DIGEST_TIMES.join(', ')} · ` +
    `auto-reply ${replyAvailable ? (env.AUTO_REPLY ? 'NYALA ' + env.REPLY_HOURS : 'MATI') : 'MATI (butuh API key)'}`);
start();
process.on('unhandledRejection', e => log('Error:', e?.message || e));
