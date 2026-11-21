// ============================================================
//  ORDER & PROSPEK — CRM mini di dalam WhatsApp
//  - Tiap chat customer dianalisis AI → tahap (prospek / hot / deal) + jadwal order
//  - Order yang ada tanggalnya disimpan → pengingat H-2, H-1, hari-H, 3 jam sebelum
//  - Order dari nomor utama dicatat manual: "catat ..." (bahasa bebas)
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
export const ordersAI = !!client;

// ---------- tanggal (zona waktu Saudi) ----------
const TZ = env.TIMEZONE;
export const ymd = (off = 0, base = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(base + off * 864e5));
export const todayLong = (base = Date.now()) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(base)) + ` (${ymd(0, base)})`;
export const nowHM = (base = Date.now()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(base));
const hari = s => new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' })
  .format(new Date(s + 'T00:00:00Z'));
const hm2min = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };

// ---------- database ----------
export function initOrdersDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, name TEXT, num TEXT, business TEXT,
      layanan TEXT, rute TEXT, tanggal TEXT, jam TEXT, pax TEXT, mobil TEXT, harga TEXT, catatan TEXT,
      status TEXT, source TEXT, locked INTEGER DEFAULT 0, created INTEGER, updated INTEGER,
      r2 INTEGER DEFAULT 0, r1 INTEGER DEFAULT 0, r0 INTEGER DEFAULT 0, rj INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS orders_tgl ON orders(tanggal, status);
    CREATE INDEX IF NOT EXISTS orders_jid ON orders(jid);
  `);
  for (const col of ['stage TEXT', 'ringkas TEXT', 'followup TEXT', 'label TEXT', 'analyzed_at INTEGER', 'stage_at INTEGER']) {
    try { db.exec(`ALTER TABLE chats ADD COLUMN ${col}`); } catch {}
  }
}

export const STAGE_ICON = { baru: '⚪', prospek: '🟡', hot: '🔥', deal: '✅', selesai: '🏁', batal: '❌', bukan: '·' };
const ST_ICON = { hot: '🔥', deal: '✅', selesai: '🏁', batal: '❌' };

// ---------- AI ----------
const BIZ = 'SupirIndo (transport & ziarah dengan supir Indonesia), PT. MII (LA/hotel/visa/handling untuk travel umrah), ' +
  'Muthowif, Pindah Kafil, Tamis (tukar riyal–rupiah), Jastip, digiKSA (website), Padel';
const TRIP = `{"layanan":"..","rute":"dari → ke"|null,"tanggal":"YYYY-MM-DD"|null,"jam":"HH:MM"|null,"pax":"jumlah orang"|null,"mobil":".."|null,"harga":"harga yg disepakati/ditawarkan"|null,"catatan":"flight, hotel, dll"|null}`;

function analyzeSystem(today) {
  return `Kamu asisten CRM. Baca percakapan WhatsApp antara CUSTOMER dan KAMI (admin/bot) untuk usaha: ${BIZ}.
Hari ini: ${today}. Zona waktu Saudi.

Tentukan:
- stage:
  "bukan"   = spam, salah sambung, urusan pribadi, bukan calon pembeli
  "baru"    = baru salam / tanya umum, kebutuhan belum jelas
  "prospek" = kebutuhan jelas (layanan tertentu) tapi tanggal/detail belum lengkap, masih tanya-tanya
  "hot"     = layanan + tanggal sudah jelas dan tanya harga/ketersediaan/mau booking, tapi BELUM konfirmasi
  "deal"    = customer jelas setuju/booking/sudah transfer DP, ATAU admin sudah mengonfirmasi booking
  "selesai" = layanan sudah dijalankan
  "batal"   = customer membatalkan / tidak jadi / pilih tempat lain
- trips: daftar pesanan yang SUDAH ADA TANGGALNYA, satu item per perjalanan/tanggal.
  Ubah "besok", "lusa", "Senin depan", "25 Nov" jadi YYYY-MM-DD berdasarkan hari ini. Jam pakai format 24 jam.
  Field yang tidak disebut = null. JANGAN mengarang. Tidak ada tanggal = trips kosong [].
- followup: 1 kalimat langkah berikutnya untuk admin (contoh: "kirim harga Hiace Jeddah–Makkah", "minta nomor flight").

Jawab HANYA JSON:
{"stage":"..","business":"SupirIndo|PT. MII|Muthowif|Pindah Kafil|Tamis|Jastip|digiKSA|Padel|Lainnya","ringkas":"1–2 kalimat kebutuhan customer","followup":"..","trips":[${TRIP}]}`;
}

function manualSystem(today) {
  return `Kamu asisten admin. Admin mengetik catatan order bebas (dari chat customer di nomor lain) untuk usaha: ${BIZ}.
Hari ini: ${today}. Zona waktu Saudi. Ubah "besok", "lusa", "Senin", "25/11" jadi YYYY-MM-DD. Jam 24 jam ("jam 2 siang" = 14:00).
Satu item per perjalanan/tanggal. Field yang tidak disebut = null, JANGAN mengarang.
nomor = nomor WA customer kalau ada (hanya angka, format internasional; 08xx → 628xx, 05xx → 9665xx).
status: "deal" kalau sudah pasti/booking/DP, "hot" kalau masih calon/belum pasti (default "deal").
Jawab HANYA JSON:
{"nama":".."|null,"nomor":".."|null,"business":"SupirIndo|PT. MII|Muthowif|Pindah Kafil|Tamis|Jastip|digiKSA|Padel|Lainnya","status":"deal|hot","trips":[${TRIP}]}`;
}

function editSystem(today) {
  return `Kamu asisten admin. Ada 1 data order (JSON) dan instruksi perubahan dari admin.
Hari ini: ${today}. Zona waktu Saudi. Tanggal YYYY-MM-DD, jam 24 jam. Ubah HANYA yang diminta, sisanya tetap.
Jawab HANYA JSON order yang sudah diubah dengan field: nama, nomor, layanan, rute, tanggal, jam, pax, mobil, harga, catatan.`;
}

async function askJSON(system, content, maxTokens = 1200) {
  const res = await client.messages.create({ model: env.CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] });
  const raw = res.content.map(b => b.text || '').join('');
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

const clean = v => (v === null || v === undefined || v === '' || v === 'null') ? null : String(v).trim().slice(0, 200);
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null;
const validTime = s => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(s || ''); return m && +m[1] < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
function normTrip(t) {
  return { layanan: clean(t.layanan) || 'Order', rute: clean(t.rute), tanggal: validDate(t.tanggal), jam: validTime(t.jam),
           pax: clean(t.pax), mobil: clean(t.mobil), harga: clean(t.harga), catatan: clean(t.catatan) };
}

/** Analisis 1 chat. history: [{role, text, ts}] */
export async function analyzeChat(history) {
  if (!client) return null;
  const fmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const convo = history.map(h => `[${fmt.format(new Date(h.ts))}] ${h.role === 'user' ? 'CUSTOMER' : 'KAMI'}: ${h.text.slice(0, 800)}`).join('\n');
  const out = await askJSON(analyzeSystem(todayLong()), convo);
  const stage = Object.keys(STAGE_ICON).includes(out.stage) ? out.stage : 'baru';
  return {
    stage, business: clean(out.business) || 'Lainnya', ringkas: clean(out.ringkas) || '', followup: clean(out.followup) || '',
    trips: (Array.isArray(out.trips) ? out.trips : []).map(normTrip).filter(t => t.tanggal),
  };
}

/** Simpan hasil analisis ke tabel orders. Return order yang baru jadi "deal". */
export function syncChatOrders(db, chat, a) {
  const now = Date.now();
  const status = ['deal', 'selesai', 'batal'].includes(a.stage) ? a.stage : 'hot';
  const existing = db.prepare(`SELECT * FROM orders WHERE jid=? AND source='chat'`).all(chat.jid);
  const used = new Set(); const newDeals = [];
  if (!['hot', 'deal', 'selesai', 'batal'].includes(a.stage)) return newDeals;
  for (const t of a.trips) {
    const m = existing.find(o => !used.has(o.id) && o.tanggal === t.tanggal && (!o.jam || !t.jam || o.jam === t.jam)) ||
              existing.find(o => !used.has(o.id) && o.tanggal === t.tanggal);
    if (m) {
      used.add(m.id);
      if (m.locked) continue;                                  // lu udah ubah manual → jangan ditimpa
      db.prepare(`UPDATE orders SET name=?, num=?, business=?, layanan=?, rute=COALESCE(?,rute), jam=COALESCE(?,jam), pax=COALESCE(?,pax),
                  mobil=COALESCE(?,mobil), harga=COALESCE(?,harga), catatan=COALESCE(?,catatan), status=?, updated=? WHERE id=?`)
        .run(chat.name, chat.num, a.business, t.layanan, t.rute, t.jam, t.pax, t.mobil, t.harga, t.catatan, status, now, m.id);
      if (status === 'deal' && m.status !== 'deal') newDeals.push({ ...m, ...t, status, id: m.id });
    } else {
      const r = db.prepare(`INSERT INTO orders(jid,name,num,business,layanan,rute,tanggal,jam,pax,mobil,harga,catatan,status,source,created,updated)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'chat',?,?)`)
        .run(chat.jid, chat.name, chat.num, a.business, t.layanan, t.rute, t.tanggal, t.jam, t.pax, t.mobil, t.harga, t.catatan, status, now, now);
      if (status === 'deal') newDeals.push({ ...t, id: Number(r.lastInsertRowid), name: chat.name, num: chat.num, status });
    }
  }
  // order lama yang gak disebut lagi (biasanya jadwal diganti)
  for (const o of existing) {
    if (used.has(o.id) || o.locked || ['selesai', 'batal'].includes(o.status)) continue;
    if (a.stage === 'batal') db.prepare(`UPDATE orders SET status='batal', updated=? WHERE id=?`).run(now, o.id);
    else if (a.trips.length && o.tanggal >= ymd()) {
      if (o.status === 'hot') db.prepare('DELETE FROM orders WHERE id=?').run(o.id);
      else db.prepare(`UPDATE orders SET status='batal', catatan=TRIM(COALESCE(catatan,'') || ' (jadwal diganti)'), updated=? WHERE id=?`).run(now, o.id);
    }
  }
  return newDeals;
}

/** "catat ..." dari nomor utama → order baru */
export async function addManualOrder(db, text) {
  if (!client) throw new Error('API key Claude belum diisi');
  const o = await askJSON(manualSystem(todayLong()), text);
  const trips = (Array.isArray(o.trips) ? o.trips : []).map(normTrip);
  if (!trips.length) return [];
  const num = (clean(o.nomor) || '').replace(/\D/g, '');
  const status = o.status === 'hot' ? 'hot' : 'deal';
  const now = Date.now(); const out = [];
  for (const t of trips) {
    const r = db.prepare(`INSERT INTO orders(jid,name,num,business,layanan,rute,tanggal,jam,pax,mobil,harga,catatan,status,source,locked,created,updated)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',1,?,?)`)
      .run(num ? `${num}@s.whatsapp.net` : null, clean(o.nama), num, clean(o.business) || 'Lainnya',
           t.layanan, t.rute, t.tanggal, t.jam, t.pax, t.mobil, t.harga, t.catatan, status, now, now);
    out.push(db.prepare('SELECT * FROM orders WHERE id=?').get(Number(r.lastInsertRowid)));
  }
  return out;
}

/** "ubah 12 jadi tanggal 28 jam 9 pagi" */
export async function editOrder(db, id, text) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) return null;
  const cur = { nama: o.name, nomor: o.num, layanan: o.layanan, rute: o.rute, tanggal: o.tanggal, jam: o.jam, pax: o.pax, mobil: o.mobil, harga: o.harga, catatan: o.catatan };
  const n = await askJSON(editSystem(todayLong()), `ORDER:\n${JSON.stringify(cur)}\n\nINSTRUKSI:\n${text}`);
  const t = normTrip({ ...cur, ...n });
  const moved = t.tanggal !== o.tanggal || t.jam !== o.jam;
  db.prepare(`UPDATE orders SET name=?, num=?, layanan=?, rute=?, tanggal=?, jam=?, pax=?, mobil=?, harga=?, catatan=?, locked=1, updated=?
              ${moved ? ', r2=0, r1=0, r0=0, rj=0' : ''} WHERE id=?`)
    .run(clean(n.nama) ?? o.name, (clean(n.nomor) || o.num || '').replace(/\D/g, ''), t.layanan, t.rute, t.tanggal || o.tanggal, t.jam,
         t.pax, t.mobil, t.harga, t.catatan, Date.now(), id);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
}

export function setOrderStatus(db, id, status) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) return null;
  db.prepare('UPDATE orders SET status=?, locked=1, updated=? WHERE id=?').run(status, Date.now(), id);
  return { ...o, status };
}

// ---------- tampilan ----------
const link = num => num ? `wa.me/${num}` : '';
export function orderLine(o, { withDate = false } = {}) {
  const dupRute = o.rute && (o.layanan || '').toLowerCase().includes(o.rute.split(/[→>-]/)[0].trim().toLowerCase());
  const bits = [o.layanan, dupRute ? null : o.rute, o.mobil, o.pax && `${o.pax}${/\D/.test(o.pax) ? '' : ' org'}`, o.harga].filter(Boolean);
  const when = [withDate && o.tanggal && hari(o.tanggal), o.jam].filter(Boolean).join(' ');
  const who = [o.name || 'Tanpa nama', link(o.num)].filter(Boolean).join(' · ');
  return `${ST_ICON[o.status] || '•'} *#${o.id}*${when ? ' · ' + when : ''} · ${bits.join(' · ')}\n    👤 ${who}${o.catatan ? `\n    📝 ${o.catatan}` : ''}`;
}

export function buildNewDeal(o, chat) {
  const d = o.tanggal ? Math.round((Date.parse(o.tanggal) - Date.parse(ymd())) / 864e5) : null;
  const soon = d === 0 ? '\n⚠️ *HARI INI!*' : d === 1 ? '\n⚠️ *BESOK!* (H-1)' : d === 2 ? '\n⚠️ Lusa (H-2)' : '';
  return `✅ *ORDER DEAL — ${o.business || chat?.business || ''}*\n\n${orderLine(o, { withDate: true })}${soon}\n\n` +
    `_Ketik *order* untuk lihat semua jadwal. Salah? *ubah ${o.id} …* / *batal ${o.id}*_`;
}

/** daftar order ke depan (perintah "order") */
export function buildOrders(db, days = 14) {
  const from = ymd(); const to = ymd(days);
  const rows = db.prepare(`SELECT * FROM orders WHERE tanggal>=? AND tanggal<=? AND status IN ('deal','hot') ORDER BY tanggal, COALESCE(jam,'99')`).all(from, to);
  if (!rows.length) return `📅 Belum ada order ${days} hari ke depan.\nCatat order dari nomor utama: *catat <detail order>*`;
  const deal = rows.filter(r => r.status === 'deal').length;
  const out = [`📅 *ORDER ${days} HARI KE DEPAN* — ${deal} deal, ${rows.length - deal} belum deal`];
  let cur = '';
  for (const r of rows) {
    if (r.tanggal !== cur) {
      cur = r.tanggal;
      const d = Math.round((Date.parse(cur) - Date.parse(from)) / 864e5);
      out.push('', `*${hari(cur)}*${d === 0 ? ' — HARI INI' : d === 1 ? ' — besok (H-1)' : d === 2 ? ' — lusa (H-2)' : ''}`);
    }
    out.push(orderLine(r));
  }
  out.push('', '_✅ deal · 🔥 belum deal · *deal 12* / *selesai 12* / *batal 12* / *ubah 12 …*_');
  return out.join('\n');
}

/** prospek yang perlu dikejar (perintah "prospek") */
export function buildProspects(db, now = Date.now()) {
  const rows = db.prepare(`SELECT * FROM chats WHERE stage IN ('hot','prospek') AND last_ts > ? ORDER BY CASE stage WHEN 'hot' THEN 0 ELSE 1 END, last_ts DESC LIMIT 30`)
    .all(now - 10 * 864e5);
  if (!rows.length) return '🟡 Belum ada prospek aktif 10 hari terakhir.';
  const lastRole = db.prepare(`SELECT role FROM convo WHERE jid=? ORDER BY ts DESC, id DESC LIMIT 1`);
  const out = [`🎯 *PROSPEK AKTIF* (${rows.length})`];
  for (const st of ['hot', 'prospek']) {
    const list = rows.filter(r => r.stage === st);
    if (!list.length) continue;
    out.push('', st === 'hot' ? `🔥 *HOT — tinggal closing* (${list.length})` : `🟡 *PROSPEK* (${list.length})`);
    for (const r of list) {
      const ago = Math.round((now - r.last_ts) / 36e5);
      const wait = lastRole.get(r.jid)?.role === 'user' ? ' · ⏳ *nunggu dibalas*' : '';
      out.push(`• ${r.name || 'Tanpa nama'} · ${r.business || '-'} · ${ago < 24 ? ago + ' jam' : Math.round(ago / 24) + ' hari'} lalu${wait}`,
        `   ${(r.ringkas || r.summary || '').slice(0, 140)}`,
        ...(r.followup ? [`   👉 ${r.followup.slice(0, 120)}`] : []),
        ...(r.num ? [`   ${link(r.num)}`] : []));
    }
  }
  return out.join('\n');
}

function followups(db, now) {
  const rows = db.prepare(`SELECT * FROM chats WHERE stage IN ('hot','prospek') AND last_ts BETWEEN ? AND ? ORDER BY CASE stage WHEN 'hot' THEN 0 ELSE 1 END, last_ts DESC LIMIT 8`)
    .all(now - 5 * 864e5, now - 20 * 36e5);
  return rows.map(r => `${STAGE_ICON[r.stage]} ${r.name || 'Tanpa nama'} — ${(r.followup || r.ringkas || '').slice(0, 90)}${r.num ? ' · ' + link(r.num) : ''}`);
}

/** pesan pagi: hari ini, besok, lusa (H-2) + prospek yang perlu di-follow up */
export function buildAgenda(db, now = Date.now()) {
  const q = db.prepare(`SELECT * FROM orders WHERE tanggal=? AND status IN ('deal','hot') ORDER BY COALESCE(jam,'99')`);
  const out = [`☀️ *JADWAL ORDER* — ${todayLong(now).split(' (')[0]}`];
  const blocks = [[0, 'HARI INI', 'r0'], [1, 'BESOK (H-1)', 'r1'], [2, 'LUSA (H-2)', 'r2']];
  let any = false;
  for (const [off, label, flag] of blocks) {
    const rows = q.all(ymd(off, now));
    if (!rows.length) continue;
    any = true;
    out.push('', `*${label}* — ${hari(ymd(off, now))}`, ...rows.map(r => orderLine(r)));
    if (off === 2) out.push('   ☑️ Konfirmasi supir & mobil · ☑️ Konfirmasi ulang ke customer (jam, titik jemput, flight) · ☑️ DP/pelunasan');
    if (off === 1) out.push('   ☑️ Kirim nama & nomor supir ke customer · ☑️ Cek jadwal flight/kereta');
    db.prepare(`UPDATE orders SET ${flag}=1 WHERE id IN (${rows.map(r => r.id).join(',')})`).run();
  }
  if (!any) out.push('', 'Gak ada order hari ini s/d lusa.');
  const hotNoDeal = db.prepare(`SELECT COUNT(*) n FROM orders WHERE tanggal BETWEEN ? AND ? AND status='hot'`).get(ymd(0, now), ymd(2, now)).n;
  if (hotNoDeal) out.push('', `⚠️ ${hotNoDeal} order 🔥 belum deal padahal tinggal ≤2 hari — kejar atau *batal <no>*.`);
  const fu = followups(db, now);
  if (fu.length) out.push('', `📞 *PERLU DI-FOLLOW UP* (diam >20 jam)`, ...fu);
  return out.join('\n');
}

/** rekap malam */
export function buildRecap(db, now = Date.now()) {
  const start = Date.parse(ymd(0, now) + 'T00:00:00+03:00');
  const chats = db.prepare('SELECT * FROM chats WHERE last_ts>=?').all(start);
  const byStage = chats.reduce((a, c) => ((a[c.stage || 'baru'] = (a[c.stage || 'baru'] || 0) + 1), a), {});
  const newDeals = db.prepare(`SELECT * FROM orders WHERE status='deal' AND updated>=? ORDER BY tanggal`).all(start);
  const week = db.prepare(`SELECT tanggal, COUNT(*) n, SUM(status='deal') d FROM orders WHERE tanggal>? AND tanggal<=? AND status IN ('deal','hot') GROUP BY tanggal ORDER BY tanggal`)
    .all(ymd(0, now), ymd(7, now));
  const out = [`🌙 *REKAP HARI INI* — ${hari(ymd(0, now))}`, '',
    `💬 Chat aktif: ${chats.length}  (🔥 ${byStage.hot || 0} hot · 🟡 ${byStage.prospek || 0} prospek · ✅ ${byStage.deal || 0} deal · ⚪ ${byStage.baru || 0} baru)`];
  if (newDeals.length) out.push('', `✅ *Deal / update hari ini* (${newDeals.length})`, ...newDeals.map(o => orderLine(o, { withDate: true })));
  if (week.length) out.push('', '📅 *7 hari ke depan*', ...week.map(w => `• ${hari(w.tanggal)}: ${w.d} deal${w.n - w.d ? `, ${w.n - w.d} belum deal` : ''}`));
  out.push('', '_Detail: *order* · *prospek*_');
  return out.join('\n');
}

/** order deal hari ini yang 3 jam lagi berangkat → return list (sekali kirim) */
export function dueSoon(db, now = Date.now()) {
  const rows = db.prepare(`SELECT * FROM orders WHERE tanggal=? AND status='deal' AND jam IS NOT NULL AND rj=0`).all(ymd(0, now));
  const cur = hm2min(nowHM(now));
  const due = rows.filter(r => { const t = hm2min(r.jam); return t !== null && t - cur <= 180 && t - cur >= -30; });
  for (const r of due) db.prepare('UPDATE orders SET rj=1 WHERE id=?').run(r.id);
  return due;
}

export function pruneOrders(db) {
  db.prepare(`UPDATE orders SET status='selesai' WHERE status='deal' AND tanggal < ?`).run(ymd(-1));
  db.prepare(`DELETE FROM orders WHERE status='hot' AND tanggal < ?`).run(ymd(-3));
  db.prepare('DELETE FROM orders WHERE tanggal < ?').run(ymd(-365));
}
