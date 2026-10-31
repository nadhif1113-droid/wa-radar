// Menyusun teks yang dikirim ke WA lu: alert, digest, trend, daftar group.
import { CATEGORIES, env } from './config.js';
import { hourKey } from './db.js';

const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const ICON = { transport: '🚐', muthowif: '🧭', visa: '🛂', tamis: '💱', bagasi: '🧳', tasreh: '🕌', hunian: '🏠',
  tiket: '✈️', makanan: '🍱', pijat: '💆', medis: '💊', jasa: '🔧', loker: '💼', lain: '•' };
const label = id => CAT[id]?.label || 'Lain-lain';
const isMine = id => !!CAT[id]?.mine;

const timeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: env.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('id-ID', { timeZone: env.TIMEZONE, weekday: 'short', day: 'numeric', month: 'short' });
const oneLine = (s, n = 160) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function who(it) {
  const name = it.sender_name || 'Anon';
  return it.sender_num ? `${name} · wa.me/${it.sender_num}` : name;
}

function line(it, i) {
  const what = it.summary || oneLine(it.text);
  return `${i}. ${ICON[it.category] || '•'} ${what}${it.urgent ? ' ⚡' : ''}\n` +
         `    👤 ${who(it)} · ${it.group_name} ${timeFmt.format(it.ts)}`;
}

// Draf sapaan yang langsung kebuka di WA lu (lu tetap yang kirim, dari nomor utama)
function chatLink(it) {
  if (!it.sender_num) return null;
  const what = oneLine(it.summary || it.text, 90).replace(/[*_~]/g, '');
  const name = it.sender_name && it.sender_name !== 'Anon' ? ` ${it.sender_name.split(/\s+/)[0]}` : '';
  const msg = `Assalamualaikum${name}, saya lihat di group ${it.group_name} lagi cari: "${what}". ` +
              `Insya Allah saya bisa bantu, boleh info detailnya?`;
  return `https://wa.me/${it.sender_num}?text=${encodeURIComponent(msg)}`;
}

export function buildAlert(it) {
  const link = chatLink(it);
  return `🔔 *LEAD — ${label(it.category)}*${it.urgent ? ' ⚡ URGENT' : ''}\n\n` +
         `"${oneLine(it.text, 500)}"\n\n` +
         `👤 ${it.sender_name || 'Anon'}${it.sender_num ? ` · +${it.sender_num}` : ''}\n` +
         `👥 ${it.group_name} · ${timeFmt.format(it.ts)}\n\n` +
         (link ? `💬 Chat sekarang (draf sapaan siap, tinggal kirim):\n${link}`
               : `📵 Nomornya disembunyikan WA, balas lewat group atau cek profilnya di group.`);
}

function sumStats(db, sinceTs, untilTs = Date.now()) {
  const rows = db.prepare('SELECT kind, SUM(n) n FROM stats WHERE bucket >= ? AND bucket <= ? GROUP BY kind')
    .all(hourKey(sinceTs), hourKey(untilTs));
  return Object.fromEntries(rows.map(r => [r.kind, r.n]));
}

export function buildDigest(db, { sinceTs, untilTs = Date.now(), mark = true, maxLead = 15, maxOther = 10, maxInfo = 5 } = {}) {
  const items = db.prepare(`SELECT * FROM items WHERE digested=0 AND ts>=? AND ts<=? AND kind IN ('tanya','info') ORDER BY ts`)
    .all(sinceTs, untilTs);
  const leads = items.filter(i => i.kind === 'tanya' && isMine(i.category));
  const other = items.filter(i => i.kind === 'tanya' && !isMine(i.category));
  const info = items.filter(i => i.kind === 'info');
  const s = sumStats(db, sinceTs, untilTs);
  const groups = db.prepare(`SELECT COUNT(DISTINCT group_jid) n FROM stats WHERE bucket>=? AND kind='total'`).get(hourKey(sinceTs)).n;
  const hours = Math.round((untilTs - sinceTs) / 36e5);

  const out = [];
  out.push(`📡 *RADAR GROUP* — ${dayFmt.format(untilTs)}, ${timeFmt.format(untilTs)}`);
  out.push(`${hours} jam terakhir: ${s.total || 0} pesan dari ${groups} group → *${items.length} penting*`);
  out.push(`🗑️ dibuang: ${s.ulang || 0} iklan berulang · ${s.iklan || 0} iklan baru · ${s.media || 0} media · ${(s.kosong || 0) + (s.lain || 0)} obrolan`);

  const section = (title, list, max) => {
    if (!list.length) return;
    out.push('', `${title} (${list.length})`);
    list.slice(-max).reverse().forEach((it, i) => out.push(line(it, i + 1)));
    if (list.length > max) out.push(`    …+${list.length - max} lagi (ketik *leads*)`);
  };
  section('🔥 *LEAD LAYANAN LU*', leads, maxLead);
  section('❓ *KEBUTUHAN LAIN*', other, maxOther);
  section('📢 *INFO*', info, maxInfo);
  if (!items.length) out.push('', 'Gak ada pertanyaan/info penting di periode ini.');

  const top = topDemand(db, 7).slice(0, 3);
  if (top.length) out.push('', `📈 Paling dicari 7 hari: ${top.map(t => `${label(t.category).split(' /')[0]} (${t.n})`).join(', ')}`);
  out.push('_Ketik *menu* untuk perintah lain._');

  if (mark && items.length) {
    const ids = items.map(i => i.id);
    db.prepare(`UPDATE items SET digested=1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  return out.join('\n');
}

function catCounts(db, side, fromTs, toTs) {
  return db.prepare(`SELECT category, SUM(n) n FROM catstats WHERE side=? AND bucket>=? AND bucket<? GROUP BY category`)
    .all(side, hourKey(fromTs), hourKey(toTs));
}
function topDemand(db, days, now = Date.now()) {
  return catCounts(db, 'demand', now - days * 864e5, now + 36e5).filter(r => r.category !== 'lain').sort((a, b) => b.n - a.n);
}

export function buildTrend(db, now = Date.now()) {
  const wk = 7 * 864e5, end = now + 36e5;
  const dNow = Object.fromEntries(catCounts(db, 'demand', now - wk, end).map(r => [r.category, r.n]));
  const dPrev = Object.fromEntries(catCounts(db, 'demand', now - 2 * wk, now - wk).map(r => [r.category, r.n]));
  const sNow = Object.fromEntries(catCounts(db, 'supply', now - wk, end).map(r => [r.category, r.n]));
  const cats = [...CATEGORIES.map(c => c.id)];
  const out = ['📈 *TREND 7 HARI* (vs 7 hari sebelumnya)', '', '*Paling DICARI* (pertanyaan):'];
  const dem = cats.filter(c => dNow[c]).sort((a, b) => dNow[b] - dNow[a]);
  if (!dem.length) out.push('• belum ada data');
  for (const c of dem.slice(0, 8)) {
    const diff = dNow[c] - (dPrev[c] || 0);
    const arrow = !dPrev[c] ? '🆕' : diff > 0 ? `▲${diff}` : diff < 0 ? `▼${-diff}` : '=';
    out.push(`${ICON[c]} ${label(c)}: ${dNow[c]} ${arrow}${isMine(c) ? ' ⭐' : ''}`);
  }
  out.push('', '*Paling BANYAK DIJUAL* (iklan unik):');
  const sup = cats.filter(c => sNow[c]).sort((a, b) => sNow[b] - sNow[a]);
  for (const c of sup.slice(0, 6)) out.push(`${ICON[c]} ${label(c)}: ${sNow[c]}`);
  const opp = cats.filter(c => (dNow[c] || 0) >= 3)
    .map(c => ({ c, r: dNow[c] / ((sNow[c] || 0) + 1) })).sort((a, b) => b.r - a.r).slice(0, 3);
  if (opp.length) {
    out.push('', '💡 *Peluang* (banyak dicari, sedikit yang jual):');
    for (const o of opp) out.push(`• ${label(o.c)}: ${dNow[o.c]} dicari vs ${sNow[o.c] || 0} penjual`);
  }
  out.push('', '⭐ = layanan lu');
  return out.join('\n');
}

export function listGroups(db) {
  return db.prepare('SELECT rowid AS no, jid, name, mode FROM groups ORDER BY rowid').all();
}

export function buildGroups(db, now = Date.now()) {
  const since = hourKey(now - 7 * 864e5);
  const st = db.prepare('SELECT kind, SUM(n) n FROM stats WHERE group_jid=? AND bucket>=? GROUP BY kind');
  const out = ['👥 *GROUP DIPANTAU* (7 hari terakhir)', ''];
  const modeIcon = { alert: '🔔', digest: '📋', ignore: '🔇' };
  for (const g of listGroups(db)) {
    const s = Object.fromEntries(st.all(g.jid, since).map(r => [r.kind, r.n]));
    const tot = s.total || 0;
    const junk = (s.ulang || 0) + (s.iklan || 0) + (s.media || 0) + (s.kosong || 0) + (s.lain || 0);
    const pct = tot ? Math.round((junk / tot) * 100) : 0;
    out.push(`${g.no}. ${modeIcon[g.mode] || ''} *${g.name || g.jid}*`);
    out.push(`    ${Math.round(tot / 7)}/hari · ${pct}% gak penting · ${s.tanya || 0} pertanyaan · ${s.info || 0} info`);
  }
  out.push('', '🔔 alert = tiap pertanyaan langsung dikirim', '📋 digest = masuk rangkuman', '🔇 ignore = dicuekin',
    'Ubah: *mode 2 alert* / *mode 2 digest* / *mode 2 ignore*');
  return out.join('\n');
}

export const MENU = `🤖 *RADAR GROUP — MENU*

*digest* — rangkuman sejak digest terakhir
*leads* — semua lead layanan lu 24 jam terakhir
*trend* — yang lagi rame dicari & dijual 7 hari
*grup* — daftar group + skor sampah
*mode 2 alert* — ubah mode group no. 2 (alert/digest/ignore)
*cari kata* — cari pesan penting, contoh: *cari tasreh*
*status* — cek bot hidup

Digest otomatis jam ${env.DIGEST_TIMES.join(' & ')}.`;

export function buildLeads(db, now = Date.now()) {
  const items = db.prepare(`SELECT * FROM items WHERE kind='tanya' AND ts>=? ORDER BY ts DESC`).all(now - 864e5)
    .filter(i => isMine(i.category));
  if (!items.length) return 'Belum ada lead layanan lu dalam 24 jam terakhir.';
  return [`🔥 *LEAD 24 JAM* (${items.length})`, ...items.slice(0, 30).map((it, i) => line(it, i + 1))].join('\n');
}

export function buildSearch(db, q, now = Date.now()) {
  const items = db.prepare(`SELECT * FROM items WHERE kind IN ('tanya','info') AND ts>=? AND (text LIKE ? OR summary LIKE ?)
                            ORDER BY ts DESC LIMIT 20`).all(now - env.RETAIN_DAYS * 864e5, `%${q}%`, `%${q}%`);
  if (!items.length) return `Gak ketemu pesan penting soal "${q}".`;
  return [`🔎 *"${q}"* (${items.length} terbaru)`, ...items.map((it, i) => line(it, i + 1))].join('\n');
}
