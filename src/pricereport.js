// Laporan harga pasar untuk WA: ringkasan mingguan + detail per produk (penjual termurah & kontaknya)
import { LABEL, GROUP, CUR, ITEMS, fmt, quantile } from './prices.js';
import { env } from './config.js';

const ORDER = ['Visa', 'Hotel', 'Paket', 'Layanan', 'Transport', 'Dokumen', 'Tamis'];
const dFmt = new Intl.DateTimeFormat('id-ID', { timeZone: env.TIMEZONE, day: 'numeric', month: 'short' });

export function initPriceDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, hash TEXT, group_jid TEXT, group_name TEXT,
      sender TEXT, sender_num TEXT, item TEXT, cur TEXT, v REAL, room TEXT, city TEXT, hotel TEXT, line TEXT, n INTEGER DEFAULT 1);
    CREATE INDEX IF NOT EXISTS prices_ts ON prices(ts, item);
    CREATE INDEX IF NOT EXISTS prices_hash ON prices(hash);
  `);
}

const rowsFor = (db, from, to, items) =>
  db.prepare(`SELECT * FROM prices WHERE ts>=? AND ts<? AND item IN (${items.map(() => '?').join(',')})`).all(from, to, ...items);

function stat(vs) {
  return { n: vs.length, med: quantile(vs, .5), p25: quantile(vs, .25), p75: quantile(vs, .75) };
}
function arrow(now, prev, cur) {
  if (!prev) return '';
  const d = now - prev;
  if (Math.abs(d) / prev < 0.02) return ' =';
  const v = cur === 'KURS' ? Math.round(Math.abs(d)) : fmt(Math.abs(d), cur).replace(' SAR', '');
  return d > 0 ? ` ▲${v}` : ` ▼${v}`;
}

/** Ringkasan 7 hari (dibanding 7 hari sebelumnya) */
export function buildPriceReport(db, now = Date.now()) {
  const wk = 7 * 864e5;
  const cur = db.prepare('SELECT * FROM prices WHERE ts>=? AND ts<?').all(now - wk, now + 1);
  const prev = db.prepare('SELECT * FROM prices WHERE ts>=? AND ts<?').all(now - 2 * wk, now - wk);
  if (!cur.length) return '💹 Belum ada data harga minggu ini. Bot mulai mencatat harga dari iklan yang masuk, laporan pertama muncul setelah beberapa hari.';
  const sellers = new Set(cur.map(r => r.sender)).size;
  const out = [`💹 *HARGA PASAR 7 HARI* (${dFmt.format(now - wk)} – ${dFmt.format(now)})`,
    `${cur.length} harga dari ${sellers} penjual · angka = median (rentang wajar)`];
  const by = (rs, f) => rs.reduce((a, r) => ((a[f(r)] ||= []).push(r.v), a), {});
  const cItem = by(cur, r => r.item); const pItem = by(prev, r => r.item);
  for (const g of ORDER) {
    const lines = [];
    if (g === 'Hotel') {
      for (const city of ['Makkah', 'Madinah']) {
        let room = 'Quad';
        let cv = cur.filter(r => r.item === 'hotel' && r.city === city && r.room === 'Quad').map(r => r.v);
        let pv = prev.filter(r => r.item === 'hotel' && r.city === city && r.room === 'Quad').map(r => r.v);
        if (cv.length < 3) {                                   // quad sedikit → pakai semua tipe kamar
          room = 'Semua tipe';
          cv = cur.filter(r => r.item === 'hotel' && r.city === city).map(r => r.v);
          pv = prev.filter(r => r.item === 'hotel' && r.city === city).map(r => r.v);
        }
        if (cv.length < 3) continue;
        const s = stat(cv); const p = pv.length >= 3 ? quantile(pv, .5) : 0;
        lines.push(`• ${room === 'Quad' ? 'Quad' : 'Kamar'} ${city}${room === 'Quad' ? '' : ' (semua tipe)'}: ${fmt(s.med, 'SAR')} (${Math.round(s.p25)}–${Math.round(s.p75)})${arrow(s.med, p, 'SAR')} · ${s.n}`);
      }
      if ((cItem.hotel_ramadan || []).length >= 3) {
        const s = stat(cItem.hotel_ramadan);
        lines.push(`• Ramadhan 1448: ${fmt(s.med, 'SAR')} (${Math.round(s.p25)}–${Math.round(s.p75)}) · ${s.n}`);
      }
    } else {
      for (const [id] of [...ITEMS, ['kurs']]) {
        if (GROUP[id] !== g || id.startsWith('hotel')) continue;
        const vs = cItem[id] || []; if (vs.length < 3) continue;
        const s = stat(vs); const pv = (pItem[id] || []).length >= 3 ? quantile(pItem[id], .5) : 0;
        const c = CUR[id];
        const range = c === 'IDR' ? `${fmt(s.p25, c).replace('Rp', '')}–${fmt(s.p75, c).replace('Rp', '')}` : c === 'USD' ? `$${Math.round(s.p25)}–${Math.round(s.p75)}` : `${Math.round(s.p25)}–${Math.round(s.p75)}`;
        lines.push(`• ${LABEL[id]}: ${fmt(s.med, c)} (${range})${arrow(s.med, pv, c)} · ${s.n}`);
      }
    }
    if (lines.length) out.push('', `*${g}*`, ...lines);
  }
  out.push('', '_▲▼ = dibanding minggu lalu · angka terakhir = jumlah penawaran_',
    'Detail & penjual termurah: *harga visa* · *harga hotel* · *harga handling* · *harga tasreh* · *harga kurs* · *harga paket*');
  return out.join('\n');
}

const KEYS = [
  [/visa/, ['visa_usd', 'visa_long', 'visa_short', 'visa_transit', 'visa_bisnis', 'visa_idr']],
  [/ramadhan|ramadan/, ['hotel_ramadan']],
  [/hotel|kamar/, ['hotel', 'hotel_ramadan']],
  [/handling/, ['handling']],
  [/\bla\b|land/, ['la_sar']],
  [/paket|umro|umra/, ['paket', 'la_sar']],
  [/tiket|seat|pesawat|pnr/, ['seat']],
  [/tasreh|tasrih|raudh/, ['tasreh_sar', 'tasreh_idr']],
  [/siskopatuh/, ['siskopatuh']],
  [/vaksin|meningitis/, ['vaksin']],
  [/brn/, ['brn']],
  [/void|dummy/, ['void', 'dummy']],
  [/kereta|hhr/, ['hhr_tiket']],
  [/bus|transport|mobil/, ['bus']],
  [/nasi|catering|albaik|makan/, ['nasibox', 'albaik']],
  [/kurs|tamis|riyal|rupiah/, ['kurs']],
  [/jastip|bagasi/, ['jastip']],
  [/mushaf|quran/, ['mushaf']],
  [/transmitter|radio/, ['transmitter']],
  [/muthow|mutow|mutaw|guide/, ['muthowif']],
];

/** Detail 1 produk: statistik 14 hari + penjual termurah dengan kontak */
export function buildPriceDetail(db, q, now = Date.now()) {
  const ql = q.toLowerCase();
  const hit = KEYS.find(([rx]) => rx.test(ql));
  if (!hit) return `Produk "${q}" belum dikenal. Coba: visa, hotel, ramadhan, handling, paket, tiket, tasreh, siskopatuh, vaksin, kurs, bus, nasi, jastip, mushaf, transmitter.`;
  const items = hit[1]; const from = now - 14 * 864e5;
  const rs = rowsFor(db, from, now + 1, items);
  if (!rs.length) return `Belum ada harga ${q} dalam 14 hari terakhir.`;
  const out = [`💹 *HARGA ${q.toUpperCase()}* · 14 hari terakhir`];
  for (const id of items) {
    const r = rs.filter(x => x.item === id); if (!r.length) continue;
    const vs = r.map(x => x.v); const s = stat(vs); const c = CUR[id];
    out.push('', `*${LABEL[id]}*: ${fmt(s.med, c)} (wajar ${fmt(s.p25, c)}–${fmt(s.p75, c)}) · ${s.n} penawaran, ${new Set(r.map(x => x.sender)).size} penjual`);
    const floor = vs.length >= 20 ? quantile(vs, 0.05) : -Infinity;   // buang pencilan hanya kalau datanya banyak
    const seen = new Set(); const cheap = [];
    for (const x of [...r].sort((a, b) => a.v - b.v)) {
      if (x.v < floor || seen.has(x.sender)) continue;
      seen.add(x.sender); cheap.push(x); if (cheap.length === 5) break;
    }
    cheap.forEach((x, i) => {
      const who = `${x.sender || 'Anon'}${x.sender_num ? ' · wa.me/' + x.sender_num : ''}`;
      const where = [x.hotel, x.room, x.city].filter(Boolean).join(' ');
      out.push(`${i + 1}. ${fmt(x.v, c)}${where ? ' — ' + where : ''} · ${who}`, `    "${x.line.slice(0, 90)}" (${x.group_name}, ${dFmt.format(x.ts)}${x.n > 1 ? `, ${x.n}x` : ''})`);
    });
  }
  if (items.includes('hotel')) {
    const named = rs.filter(x => x.item === 'hotel' && x.hotel && x.room === 'Quad');
    const g = named.reduce((a, x) => ((a[`${x.hotel}|${x.city || '-'}`] ||= []).push(x.v), a), {});
    const top = Object.entries(g).filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
    if (top.length) {
      out.push('', '*Quad per hotel* (median · termurah)');
      for (const [k, v] of top) { const [h, c] = k.split('|'); out.push(`• ${h} (${c}): ${Math.round(quantile(v, .5))} · ${Math.round(Math.min(...v))} SAR`); }
    }
  }
  out.push('', '_Harga iklan, bukan harga deal. Konfirmasi tanggal & syarat ke penjual._');
  return out.join('\n');
}
