// ============================================================
//  RADAR GROUP — bot WhatsApp pemantau group (HANYA MEMBACA)
//  Bot tidak pernah mengirim apa pun ke group. Semua hasil dikirim ke WA utama lu.
// ============================================================
import makeWASocket, {
  useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore,
  DisconnectReason, Browsers, isJidGroup,
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

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
if (!env.OWNER_NUMBER) { console.error('❌ Isi OWNER_NUMBER di file .env dulu (nomor WA utama lu, contoh 9665xxxxxxx)'); process.exit(1); }

const db = openDb();
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
const isCommand = t => /^[!/.]?\s*(menu|help|bantuan|status|digest|leads?|trend|tren|grup|groups?|mode\s+\d+\s+\w+|cari\s+.+)\s*$/i.test((t || '').trim());
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
    return toOwner(`✅ Bot hidup. Memantau ${n} group. AI: ${aiEnabled ? 'nyala' : 'mati (aturan saja)'}.`);
  }
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

      if (isJidGroup(jid)) {
        if (msg.key.fromMe) continue;
        const p = msg.key.participantAlt || msg.key.participant || '';
        const senderNum = p.endsWith('@s.whatsapp.net') ? digits(p) : '';
        let groupName = db.prepare('SELECT name FROM groups WHERE jid=?').get(jid)?.name;
        if (!groupName) { try { groupName = (await sock.groupMetadata(jid)).subject; } catch { groupName = jid; } }
        processMessage(db, {
          ts: Number(msg.messageTimestamp) * 1000 || Date.now(), groupJid: jid, groupName,
          senderName: msg.pushName || '', senderNum, text: ex.text, hasMedia: ex.hasMedia,
        });
        continue;
      }

      // chat pribadi: hanya dari nomor utama lu
      const fromOwner = [jid, msg.key.remoteJidAlt].some(j => digits(j) === env.OWNER_NUMBER);
      if (fromOwner && !msg.key.fromMe && ex.text) await handleCommand(jid, ex.text);
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

log(`Radar Group start · AI ${aiEnabled ? 'NYALA (' + env.CLAUDE_MODEL + ')' : 'MATI'} · digest ${env.DIGEST_TIMES.join(', ')}`);
start();
process.on('unhandledRejection', e => log('Error:', e?.message || e));
