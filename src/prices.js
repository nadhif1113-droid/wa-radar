// ============================================================
//  PANTAU HARGA — tarik harga dari iklan B2B (visa, hotel, handling, tasreh, dll)
//  Sama dengan metode laporan "Intel Harga Pasar Umrah 1448H".
// ============================================================

function num(s) {
  s = s.replace(/^[.,]+|[.,]+$/g, '').replace(/ /g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return +s.replace(/[.,]/g, '');
  if (/^\d+[.,]\d{1,2}$/.test(s)) return +s.replace(',', '.');
  return +s.replace(/[.,]/g, '');
}

const RX = {
  SAR: /(?:\b(?:sar|sr|riyal|rial|real)\s*[:.]?\s*(\d[\d.,]*))|(?:(\d[\d.,]*)\s*(?:sar|sr|riyal|rial|real)\b)/gi,
  USD: /(?:\$\s*\.?\s*(\d[\d.,]*))|(?:(\d[\d.,]*)\s*(?:usd|\$))/gi,
  IDR: /(?:rp\.?\s*(\d[\d.,]*)\s*(jt|juta|jutaan|rb|ribu|k)?)|(?:(\d+(?:[.,]\d+)?)\s*(jt|juta|jtan|jutaan)\b(?!\s*\d))|(?:\b(\d{2,3}(?:[.,]\d)?)\s*(rb|ribu|k)\b)/gi,
};

function prices(line) {
  const out = [];
  for (const [cur, rx] of Object.entries(RX)) {
    rx.lastIndex = 0;
    for (const m of line.matchAll(rx)) {
      const nxt = line.slice(m.index + m[0].length, m.index + m[0].length + 1);
      const digits = (m[1] || m[3] || m[5] || m[2] || '').replace(/[.,]/g, '');
      if (/[#xX*]/.test(nxt) && digits.length < 2) continue;   // "Rp 2#0.000" ambigu → buang; "Rp16.X50.000" ≈ 16 jt tetap dipakai
      let x;
      try {
        if (cur === 'IDR') {
          if (m[1]) {
            x = num(m[1]); const u = (m[2] || '').toLowerCase();
            x = ['jt', 'juta', 'jutaan'].includes(u) ? x * 1e6 : ['rb', 'ribu', 'k'].includes(u) ? x * 1e3 : (x < 100 ? x * 1e6 : x);
          } else if (m[3]) x = num(m[3]) * 1e6;
          else x = num(m[5]) * 1e3;
        } else x = num(m[1] || m[2]);
      } catch { continue; }
      if (Number.isFinite(x)) out.push({ cur, v: x, pos: m.index });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

// id, label, kelompok, regex konteks, mata uang, min, max, regex pengecualian
export const ITEMS = [
  ['siskopatuh', 'Siskopatuh', 'Dokumen', /siskopatuh/i, 'IDR', 100e3, 700e3, null],
  ['vaksin', 'Vaksin meningitis+polio', 'Dokumen', /meningitis|miningitis|polio|vaksin/i, 'IDR', 250e3, 1.2e6, null],
  ['void', 'Tiket void', 'Dokumen', /\bvoid\b/i, 'IDR', 50e3, 600e3, null],
  ['dummy', 'Tiket/hotel dummy', 'Dokumen', /dummy/i, 'IDR', 30e3, 400e3, null],
  ['brn', 'BRN hotel /pax/malam', 'Dokumen', /\bbrn\b/i, 'SAR', 3, 60, /visa/i],
  ['tasreh_sar', 'Tasreh Raudhah', 'Layanan', /tasreh|tasrih|raudh|raudoh|rawdah|roudhoh/i, 'SAR', 15, 80, /kereta|hhr|admin/i],
  ['tasreh_idr', 'Tasreh Raudhah (Rp)', 'Layanan', /tasreh|tasrih|raudh|raudoh|rawdah|roudhoh/i, 'IDR', 40e3, 250e3, /visa/i],
  ['hhr_tiket', 'Tiket kereta HHR', 'Layanan', /kereta|hhr|haramain train|high speed/i, 'SAR', 60, 600, null],
  ['visa_usd', 'Visa umrah group/only', 'Visa', /visa/i, 'USD', 100, 250, /re-?entry|voa|egypt|mesir|turis/i],
  ['visa_long', 'Visa long stay 80–90 hari', 'Visa', /long ?stay|8[05] ?hari|90 ?hari|80 hari|istid/i, 'IDR', 2.5e6, 9e6, null],
  ['visa_short', 'Visa + BRN short stay', 'Visa', /short ?stay|stay \d|\bbrn\b|1\s*-\s*7 hari|8\s*-\s*12/i, 'IDR', 1.8e6, 5e6, null],
  ['visa_transit', 'Visa transit', 'Visa', /transit/i, 'IDR', 5e5, 3e6, null],
  ['visa_bisnis', 'Visa bisnis/multiple 1 thn', 'Visa', /bisnis|business|multiple/i, 'IDR', 4e6, 2e7, null],
  ['visa_idr', 'Visa umrah lain (Rp)', 'Visa', /visa/i, 'IDR', 1.2e6, 6e6, null],
  ['handling', 'Handling bandara /pax', 'Layanan', /handling/i, 'SAR', 40, 400, null],
  ['nasibox', 'Nasi box /porsi', 'Layanan', /nasi box|snack box|catering|nasi|prasmanan/i, 'SAR', 5, 60, null],
  ['albaik', 'Albaik antar', 'Layanan', /albaik|al baik/i, 'SAR', 10, 120, null],
  ['mushaf', 'Mushaf wakaf /pcs', 'Layanan', /mushaf|quran/i, 'SAR', 10, 60, null],
  ['transmitter', 'Sewa transmitter /pax', 'Layanan', /transmitter/i, 'SAR', 2, 20, null],
  ['jastip', 'Jastip /kg', 'Layanan', /jastip|bagasi|\/kg|per kg/i, 'IDR', 3e4, 3e5, null],
  ['muthowif', 'Muthowif / TL', 'Layanan', /muthow|mutow|mutaw|muthaw|tour leader/i, 'SAR', 50, 1500, null],
  ['bus', 'Bus/mobil rombongan /trip', 'Transport', /\bbus\b|\bbis\b|gmc|hiace|coaster|staria|h1\b|sedan/i, 'SAR', 100, 4000, /visa/i],
  ['hotel_ramadan', 'Hotel Ramadhan /kamar/malam', 'Hotel', /ramadan|ramadhan/i, 'SAR', 150, 4000, /pax|lunch|dinner|makan|meal|pcs|denda|meter|tiket|bus|transport|last ?10|last ten|full ramadan|10 malam|10 hari/i],
  ['hotel', 'Hotel reguler /kamar/malam', 'Hotel', /\bdbl\b|\btrp\b|\bquad\b|\btriple\b|\bdouble\b|\btwin\b|\bq\s|\bt\s|\bd\s|room|hotel|fullboard|\bbb\b|\bro\b|night|malam/i, 'SAR', 80, 3000, /pax|ramadan|ramadhan|last ?10|last ten|full ramadan|lunch|dinner|makan|meal|pcs|denda|meter|\/hari|per hari|tiket|ticket|museum|kereta|bus|transport|antar|koper|bagasi|\/kg|per kg|jastip/i],
  ['la_sar', 'LA land (hotel+handling) /pax', 'Paket', /\bla\b|land|\/pax|per pax|paket/i, 'SAR', 500, 6000, null],
  ['seat', 'Tiket pesawat grup', 'Paket', /seat|pnr|\bsv\d|\bga\d|\bqr\d|saudia|garuda|qatar|lion|etihad|emirates|turkish|oman|tiket/i, 'IDR', 6e6, 3e7, /visa/i],
  ['paket', 'Paket umrah B2B all-in', 'Paket', /umro|umra|program|hari|paket|\d+d\b/i, 'IDR', 1.5e7, 8e7, null],
];
export const EXTRA = { kurs: ['kurs', 'Kurs tamis (Rp/SAR)', 'Tamis'] };
export const LABEL = Object.fromEntries([...ITEMS.map(i => [i[0], i[1]]), ['kurs', EXTRA.kurs[1]]]);
export const GROUP = Object.fromEntries([...ITEMS.map(i => [i[0], i[2]]), ['kurs', 'Tamis']]);
export const CUR = Object.fromEntries([...ITEMS.map(i => [i[0], i[4]]), ['kurs', 'KURS']]);

const HOTELS = ['movenpick', 'hilton', 'pullman', 'swissotel', 'swiss', 'anjum', 'dar al eiman', 'dar al tawhid', 'zamzam', 'hyatt', 'marriott',
  'fairmont', 'sheraton', 'elaf', 'frontel', 'millennium', 'rotana', 'shaza', 'jabal omar', 'shohada', 'kayan', 'nada ajyad', 'amjad assalam',
  'sari almisk', 'ruve', 'odst', 'triple one', 'concorde', 'maysan', 'safwah', 'meridien', 'intercontinental', 'dar al hijra', 'taiba', 'aqeeq',
  'golden tulip', 'grand plaza', 'makarim', 'emaar', 'bakkah', 'dallah', 'marwa', 'rayhaan', 'sofitel', 'voco', 'novotel', 'crowne', 'ebaa',
  'andalusia', 'kiswah', 'abraj', 'clock tower', 'raffles', 'wyndham', 'ramada', 'mercure', 'ibis', 'saja', 'ghufran', 'naeem', 'nozol',
  'royal inn', 'bosphorus', 'mira ajyad', 'olayan', 'ajyad', 'ansar', 'snood', 'wahat', 'mowhadeen', 'wilayah', 'prestige', 'peninsula'];

function cleanHotel(L) {
  let n = L.replace(/[^\p{L}\p{N}\s'&.-]/gu, ' ');
  n = n.replace(/\b(hotel|available|ready|price|rate|rates|special|offer|b2b|makkah|madinah|mekkah|ramadan|ramadhan|1448|h|at|the|list)\b/gi, ' ');
  n = n.replace(/^\s*\d+\.\s*/, '').replace(/\s+/g, ' ').trim().replace(/^[ \-:.*']+|[ \-:.*']+$/g, '');
  if (/\d/.test(n) || /\b(double|triple|quad|dbl|trp|room|fb|bb|ro)\b/i.test(n)) return '';
  return n.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
function hotelName(lines, idx) {
  for (let j = idx; j > Math.max(-1, idx - 9); j--) {
    const L = lines[j]; const ll = L.toLowerCase();
    if (L.includes('🏨') || /^\W*(hotel|فندق)\b/.test(ll) || HOTELS.some(h => ll.includes(h))) {
      const n = cleanHotel(L);
      if (!n) continue;
      if (n.length >= 3 && n.length <= 40 && !/\d{3}/.test(n)) return n;
    }
  }
  return '';
}
const cityOf = (txt, fallback) => /madinah|madina|medina|nabawi/.test(txt) ? 'Madinah' : /makkah|mekkah|mecca|makah|ajyad|misfalah|aziziyah|jabal omar/.test(txt) ? 'Makkah' : fallback;

/** Tarik semua harga dari 1 iklan → [{item, cur, v, room, city, hotel, line}] */
export function extractPrices(text) {
  const rows = [];
  const lines = text.split('\n').map(l => l.trim());
  const adl = text.toLowerCase();
  const adCity = cityOf(adl, '');
  const isPaketAd = /include|fasilitas|termasuk|mutowif|muthowif|hotel (madinah|makkah|mekkah)|all ?in|program \d+|\d+ ?hari|makan/.test(adl);
  const ram = /ramadan|ramadhan/.test(adl);
  let head = '';
  lines.forEach((l, idx) => {
    if (!l) return;
    const ps = prices(l);
    const ctx = (head + ' ' + l).toLowerCase(); const lineonly = l.toLowerCase();
    // rate hotel tanpa "SAR": "D 650 • T 700 • Q 750" / "Dbl: 540 | Trp: 585"
    if (/hotel|room|fullboard|\bbb\b|\bro\b|available|rate/.test(adl) && !/\bsar\b|\bsr\b|riyal/.test(lineonly)
        && !/seat|pnr|meter|\bkm\b|lunch|dinner|makan|meal|denda|pcs|\bhk\d|\bkk\d|jam|pukul/.test(lineonly)) {
      for (const m of lineonly.matchAll(/(?<![a-z0-9])(dbl|double|twin|trp|triple|quad|d|t|q)\s*[:=\-]?\s*(\d[.,]\d{3}|\d{4}|\d{3})(?![\d.,])(?!\s*(?:jt|juta|rb|k\b|%|pax|hari|night|malam|kamar|room|seat|m\b))/g)) {
        const v = num(m[2]);
        if (!(v >= 100 && v <= 4000)) continue;
        const near = ctx + ' ' + lines.slice(Math.max(0, idx - 4), idx).join(' ').toLowerCase();
        const k = m[1];
        rows.push({ item: ram ? 'hotel_ramadan' : 'hotel', cur: 'SAR', v, room: ['q', 'quad'].includes(k) ? 'Quad' : ['t', 'trp', 'triple'].includes(k) ? 'Triple' : 'Double',
                    city: cityOf(near, adCity), hotel: hotelName(lines, idx), line: l.slice(0, 160) });
      }
    }
    if (!ps.length) { if (l.length < 140) head = l; return; }
    const used = new Set();
    for (const [id, , , rx, cur, lo, hi, ex] of ITEMS) {
      const c2 = ['hotel', 'hotel_ramadan', 'la_sar', 'paket', 'seat'].includes(id) ? ctx + ' ' + adl.slice(0, 300) : ctx;
      if (!rx.test(c2)) continue;
      if (id === 'seat' && isPaketAd) continue;
      if (id === 'paket' && !isPaketAd) continue;
      if (ex && ex.test(id === 'hotel' ? ctx + ' ' + adl.slice(0, 400) : lineonly)) continue;
      const cand = ps.filter(p => p.cur === cur && p.v >= lo && p.v <= hi && !used.has(p.pos));
      if (!cand.length) continue;
      const km = lineonly.search(rx);
      const pick = (km >= 0 ? cand.find(p => p.pos >= km) : null) || cand[0];
      used.add(pick.pos);
      const isHotel = id === 'hotel' || id === 'hotel_ramadan';
      rows.push({ item: id, cur, v: pick.v,
        room: /quad|\bq\b/.test(lineonly) ? 'Quad' : /triple|trp|\bt\b/.test(lineonly) ? 'Triple' : /double|dbl|twin|\bd\b/.test(lineonly) ? 'Double' : '',
        city: cityOf(ctx, adCity), hotel: isHotel ? hotelName(lines, idx) : '', line: l.slice(0, 160) });
    }
  });
  for (const m of adl.matchAll(/(?:kurs|rate|tamis)[^\n]{0,25}?\b(4[.,]?[0-9]{3})\b/g)) {
    const v = num(m[1]);
    if (v >= 3900 && v <= 4800) rows.push({ item: 'kurs', cur: 'KURS', v, room: '', city: '', hotel: '', line: m[0].slice(0, 120) });
  }
  return rows;
}

// ---------- format angka ----------
export function fmt(v, cur) {
  if (cur === 'IDR') return v >= 1e6 ? `Rp${(v / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} jt` : `Rp${Math.round(v / 1e3)} rb`;
  if (cur === 'USD') return `$${Math.round(v)}`;
  if (cur === 'KURS') return Math.round(v).toLocaleString('id-ID');
  return `${Math.round(v).toLocaleString('id-ID')} SAR`;
}
export function quantile(xs, p) {
  const s = [...xs].sort((a, b) => a - b); const k = (s.length - 1) * p; const f = Math.floor(k);
  return s[f] + ((s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f));
}
