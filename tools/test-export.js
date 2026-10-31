// Tes saringan pakai file Export Chat WhatsApp (tanpa konek WA).
// Pakai:  node tools/test-export.js "Nama Group=path/_chat.txt" "Group 2=path2/_chat.txt" ...
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { processMessage } from '../src/pipeline.js';
import { refinePending, aiEnabled } from '../src/ai.js';
import { buildDigest, buildTrend, buildGroups, buildAlert } from '../src/report.js';
import { CATEGORIES } from '../src/config.js';
import { initPriceDb, buildPriceReport, buildPriceDetail } from '../src/pricereport.js';

const HDR = /^‎?\[(\d\d)\/(\d\d)\/(\d{4}), (\d{1,2}):(\d\d):(\d\d)[\s ]*(AM|PM)?\] ([^:\n]+): /gm;

function parse(file, groupName, groupJid) {
  const txt = fs.readFileSync(file, 'utf8');
  const ms = [...txt.matchAll(HDR)];
  return ms.map((m, i) => {
    const end = i + 1 < ms.length ? ms[i + 1].index : txt.length;
    let [, dd, mo, yy, hh, mi, ss, ap, sender] = m;
    let h = Number(hh); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
    const ts = Date.UTC(+yy, +mo - 1, +dd, h - 3, +mi, +ss); // jam Riyadh (UTC+3)
    let text = txt.slice(m.index + m[0].length, end).trim();
    const hasMedia = /(image|video|sticker|document|audio|GIF) omitted/.test(text);
    text = text.replace(/‎?(image|video|sticker|document|audio|GIF|product image) omitted/g, '').replace(/‎?<This message was edited>/g, '').trim();
    sender = sender.replace(/^~[\s ]*/, '').trim();
    const num = /^\+[\d\s-]+$/.test(sender) ? sender.replace(/\D/g, '') : '';
    return { ts, groupJid, groupName, senderName: num ? '' : sender, senderNum: num, text, hasMedia };
  }).filter(x => x.senderName !== groupName);
}

const args = process.argv.slice(2);
const db = openDb(':memory:');
initPriceDb(db);
let all = [];
args.forEach((a, i) => { const [name, file] = a.split('='); all.push(...parse(file, name, `g${i}@g.us`)); });
all.sort((a, b) => a.ts - b.ts);
const end = all[all.length - 1].ts;
const startKeep = end - 14 * 864e5;            // simulasi 14 hari terakhir saja (bot baru jalan)
all = all.filter(m => m.ts >= startKeep);

let kept = 0; const mineCat = new Set(CATEGORIES.filter(c => c.mine).map(c => c.id));
let alertsRule = 0;
for (const m of all) { const it = processMessage(db, m); if (it) { kept++; if (it.kind === 'tanya' && mineCat.has(it.category)) alertsRule++; } }
console.log(`AI: ${aiEnabled ? 'NYALA' : 'MATI (pakai aturan saja)'}`);
console.log(`Pesan diproses: ${all.length} (14 hari) → disimpan: ${kept} (${(kept / all.length * 100).toFixed(1)}%)  · calon alert: ${alertsRule}\n`);

if (aiEnabled) { while ((await refinePending(db)).length); }

console.log('================ CONTOH ALERT ================');
const sample = db.prepare(`SELECT * FROM items WHERE kind='tanya' ORDER BY ts DESC`).all()
  .filter(i => mineCat.has(i.category)).slice(0, 2);
sample.forEach(s => console.log(buildAlert(s), '\n'));
console.log('================ DIGEST 12 JAM TERAKHIR ================');
console.log(buildDigest(db, { sinceTs: end - 12 * 36e5, untilTs: end, mark: false }));
console.log('\n================ TREND ================');
console.log(buildTrend(db, end));
console.log('\n================ GRUP ================');
console.log(buildGroups(db, end));

if (process.env.SHOW_PRICES) {
  console.log('\n================ HARGA ================');
  console.log(buildPriceReport(db, end));
  for (const q of (process.env.SHOW_PRICES || '').split(',').filter(x => x !== '1')) {
    console.log('\n================ HARGA ' + q + ' ================');
    console.log(buildPriceDetail(db, q, end));
  }
}
