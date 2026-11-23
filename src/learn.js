// ============================================================
//  BELAJAR MINGGUAN — pelajari gaya admin membalas + rekap minggu ini
//  Tiap minggu (sebelum chat dibersihkan) bot membaca balasan ADMIN (manusia) di nomor bisnis,
//  merangkum gaya bahasa & cara closing-nya ke pengetahuan/90-gaya-admin.md → dipakai bot membalas.
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import { env } from './config.js';
import { ymd } from './orders.js';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
export const STYLE_FILE = './pengetahuan/90-gaya-admin.md';
const BACKUP_DIR = './data/gaya-admin';

export function initLearnDb(db) {
  try { db.exec('ALTER TABLE convo ADD COLUMN src TEXT'); } catch {}     // 'admin' = diketik manusia, kosong = bot / customer
}

const hideNums = t => t.replace(/\+?\d[\d\s-]{7,}\d/g, '[nomor]');

/** transkrip chat 7 hari yang ada balasan admin-nya (paling banyak ~60rb huruf) */
function transcripts(db, since) {
  const jids = db.prepare(`SELECT jid, COUNT(*) n FROM convo WHERE src='admin' AND ts>=? AND text!='[admin]' GROUP BY jid ORDER BY n DESC LIMIT 40`).all(since);
  const out = []; let size = 0;
  for (const { jid } of jids) {
    const chat = db.prepare('SELECT stage, business FROM chats WHERE jid=?').get(jid) || {};
    const rows = db.prepare('SELECT role, src, text FROM convo WHERE jid=? AND ts>=? ORDER BY ts, id').all(jid, since - 3 * 864e5);
    const lines = rows.map(r => `${r.role === 'user' ? 'CUSTOMER' : r.src === 'admin' ? 'ADMIN' : 'BOT'}: ${hideNums(r.text).slice(0, 600)}`);
    const block = `### Chat ${out.length + 1} (${chat.business || '-'}, hasil: ${chat.stage || '-'})\n${lines.slice(-40).join('\n')}`;
    if (size + block.length > 60000) break;
    out.push(block); size += block.length;
  }
  return out;
}

const SYSTEM = `Kamu pelatih customer service. Tugasmu: mempelajari cara ADMIN (manusia) membalas chat WhatsApp customer,
supaya BOT bisa meniru gaya admin. Usaha: SupirIndo (transport & ziarah dengan supir Indonesia di Saudi), PT. MII (B2B travel umrah), dll.

Kamu diberi: (1) PANDUAN GAYA LAMA (bisa kosong), (2) transkrip chat minggu ini. Label: CUSTOMER, ADMIN (manusia), BOT.
Perbarui panduan: pertahankan yang masih benar, tambah yang baru, buang yang tidak terbukti. Fokus pada yang BERHASIL (chat dengan hasil deal/hot).

Tulis panduan dalam Markdown, maksimal ± 3500 karakter, bagian:
## Gaya bahasa admin — sapaan & panggilan, kata/ungkapan khas, panjang pesan, emoji, tingkat formal
## Kalimat admin yang bagus (contoh) — 5–10 contoh kalimat asli admin yang layak ditiru (hapus nama orang & nomor)
## Cara admin menjawab harga & menutup (closing)
## Cara admin menangani keberatan / customer ragu
## Bedanya admin vs bot — hal yang admin lakukan lebih baik dari bot (dari chat yang diambil alih admin)

Aturan: JANGAN tulis nama customer, nomor HP, atau data pribadi. JANGAN tulis angka harga di panduan (harga resmi diatur terpisah).
Kalau tidak ada data cukup untuk suatu bagian, tulis "(belum cukup data)".

Setelah panduan, tulis baris persis "=====INFO=====" lalu daftar singkat (maks 8 poin) hal baru yang admin sebut tapi mungkin belum ada di data bisnis
(harga baru, layanan baru, aturan baru, kendala yang sering muncul) — untuk dicek pemilik. Kalau tidak ada, tulis "-".`;

/** Jalankan belajar mingguan. Return { learned, info, chats } */
export async function learnStyle(db, now = Date.now()) {
  if (!client) return { error: 'API key Claude belum diisi' };
  const since = now - 7 * 864e5;
  const ts = transcripts(db, since);
  if (!ts.length) return { learned: false, chats: 0, info: '' };
  const old = fs.existsSync(STYLE_FILE) ? fs.readFileSync(STYLE_FILE, 'utf8') : '';
  const res = await client.messages.create({
    model: env.CHAT_MODEL, max_tokens: 3000, system: SYSTEM,
    messages: [{ role: 'user', content: `PANDUAN GAYA LAMA:\n${old || '(kosong)'}\n\nTRANSKRIP MINGGU INI:\n\n${ts.join('\n\n')}` }],
  });
  const raw = res.content.map(b => b.text || '').join('').trim();
  const [guide, info = ''] = raw.split('=====INFO=====');
  if (guide.trim().length < 200) return { error: 'hasil belajar terlalu pendek, panduan lama dipertahankan' };
  fs.mkdirSync('./pengetahuan', { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (old) fs.writeFileSync(`${BACKUP_DIR}/${ymd(0, now)}-sebelum.md`, old);
  fs.writeFileSync(STYLE_FILE,
    `# GAYA ADMIN (dipelajari otomatis tiap minggu, terakhir ${ymd(0, now)} dari ${ts.length} chat)\n` +
    `Tiru gaya ini saat membalas. Kalau bertentangan dengan aturan utama (harga, jangan bohong, handoff), aturan utama yang menang.\n\n` +
    guide.trim() + '\n');
  return { learned: true, chats: ts.length, info: info.trim() };
}

export function readStyle() {
  return fs.existsSync(STYLE_FILE) ? fs.readFileSync(STYLE_FILE, 'utf8') : '';
}

/** Rekap 7 hari (angka) */
export function buildWeekly(db, now = Date.now()) {
  const since = now - 7 * 864e5;
  const chats = db.prepare('SELECT * FROM chats WHERE last_ts>=?').all(since);
  const st = chats.reduce((a, c) => ((a[c.stage || 'baru'] = (a[c.stage || 'baru'] || 0) + 1), a), {});
  const biz = Object.entries(chats.reduce((a, c) => ((a[c.business || 'Belum jelas'] = (a[c.business || 'Belum jelas'] || 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]);
  const msg = db.prepare(`SELECT SUM(role='user') u, SUM(role='assistant' AND COALESCE(src,'')!='admin') b, SUM(src='admin') a FROM convo WHERE ts>=?`).get(since);
  const deals = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ('deal','selesai') AND updated>=?`).get(since).n;
  const handoff = chats.filter(c => c.handoff_at >= since).length;
  const next = db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='deal' AND tanggal>? AND tanggal<=?`).get(ymd(0, now), ymd(7, now)).n;
  const conv = chats.length ? Math.round(((st.deal || 0) + (st.selesai || 0)) / chats.length * 100) : 0;
  return [
    `📊 *REKAP MINGGUAN* (${ymd(-7, now)} – ${ymd(0, now)})`, '',
    `💬 ${chats.length} customer chat · ${msg.u || 0} pesan masuk`,
    `🤖 Bot balas ${msg.b || 0} pesan · 👤 admin balas ${msg.a || 0} pesan · 🤝 ${handoff} diteruskan ke admin`,
    `🎯 ⚪ ${st.baru || 0} baru · 🟡 ${st.prospek || 0} prospek · 🔥 ${st.hot || 0} hot · ✅ ${(st.deal || 0) + (st.selesai || 0)} deal · ❌ ${st.batal || 0} batal`,
    `📈 Konversi chat → deal: ${conv}% · order deal/selesai minggu ini: ${deals}`,
    `📅 Order deal 7 hari ke depan: ${next}`,
    ...(biz.length ? ['', '*Paling banyak ditanya*', ...biz.slice(0, 5).map(([b, n]) => `• ${b}: ${n}`)] : []),
  ].join('\n');
}
