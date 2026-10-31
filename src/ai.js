// Claude dipakai HANYA untuk calon lead/info yang lolos saringan aturan (biasanya <3% pesan) → biaya kecil.
import Anthropic from '@anthropic-ai/sdk';
import { env, CATEGORIES } from './config.js';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
export const aiEnabled = !!client;

const CAT_LIST = CATEGORIES.map(c => `${c.id} = ${c.label}`).join('\n') + '\nlain = selain di atas';

const SYSTEM = `Kamu penyaring pesan group WhatsApp komunitas Indonesia di Arab Saudi (Makkah, Madinah, Jeddah).
Untuk tiap pesan, tentukan:
- kind: "tanya" (orang butuh/mencari barang, jasa, info → calon pembeli), "info" (info/berita penting yang berguna, bukan iklan), "iklan" (orang menawarkan/jualan), atau "lain" (obrolan, salam, terima kasih, tidak berguna)
- category: salah satu id berikut:
${CAT_LIST}
- summary: ringkasan Bahasa Indonesia maksimal 12 kata, sebut apa yang dibutuhkan + jumlah/lokasi/waktu bila ada
- urgent: true jika butuh hari ini/sekarang/malam ini/besok pagi
Jawab HANYA JSON array: [{"id":..,"kind":"..","category":"..","summary":"..","urgent":true|false}]`;

/** items: [{id, text, group_name}] → Map(id → hasil) */
export async function classifyBatch(items) {
  if (!client || !items.length) return new Map();
  const payload = items.map(i => ({ id: i.id, group: i.group_name, text: i.text.slice(0, 600) }));
  const res = await client.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const raw = res.content.map(b => b.text || '').join('');
  const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
  const out = new Map();
  for (const r of JSON.parse(json)) out.set(Number(r.id), r);
  return out;
}

const validCat = new Set([...CATEGORIES.map(c => c.id), 'lain']);
const validKind = new Set(['tanya', 'info', 'iklan', 'lain']);

/** Proses semua item yang belum dicek AI. Kalau AI mati/gagal, hasil aturan dipakai apa adanya. */
export async function refinePending(db, log = console) {
  const pending = db.prepare('SELECT id, text, group_name FROM items WHERE ai_done=0 ORDER BY id LIMIT 40').all();
  if (!pending.length) return [];
  let results = new Map();
  try { results = await classifyBatch(pending); }
  catch (e) { log.warn?.(`AI gagal, pakai hasil aturan: ${e.message}`); }
  const upd = db.prepare('UPDATE items SET kind=?, category=?, summary=?, urgent=?, ai_done=1 WHERE id=?');
  const keep = db.prepare('UPDATE items SET ai_done=1 WHERE id=?');
  db.transaction(() => {
    for (const p of pending) {
      const r = results.get(p.id);
      if (r && validKind.has(r.kind)) {
        upd.run(r.kind, validCat.has(r.category) ? r.category : 'lain', r.summary || null, r.urgent ? 1 : 0, p.id);
      } else keep.run(p.id);
    }
  })();
  return pending.map(p => p.id);
}
