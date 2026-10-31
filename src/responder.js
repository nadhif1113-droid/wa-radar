// ============================================================
//  AUTO-REPLY — balas chat pribadi yang MASUK ke nomor bisnis
//  Bot tidak pernah mengirim chat duluan ke orang asing.
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import { env } from './config.js';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
export const replyAvailable = !!client;

export function initResponderDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY, name TEXT, num TEXT, business TEXT, summary TEXT,
      paused_until INTEGER DEFAULT 0, handoff_at INTEGER DEFAULT 0, last_hold_at INTEGER DEFAULT 0,
      day_key TEXT, day_replies INTEGER DEFAULT 0, last_ts INTEGER);
    CREATE TABLE IF NOT EXISTS convo (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, role TEXT, text TEXT, ts INTEGER);
    CREATE INDEX IF NOT EXISTS convo_jid ON convo(jid, ts);
  `);
}

function knowledge() {
  for (const f of ['./bisnis.md', './bisnis.example.md']) {
    try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch {}
  }
  return '';
}

function systemPrompt() {
  return `Kamu admin WhatsApp yang membalas chat customer untuk usaha di bawah ini.

${knowledge()}

## CARA MEMBALAS
- Bahasa: ikuti bahasa customer (default Bahasa Indonesia yang sopan dan hangat, sapa "Bapak/Ibu"; kalau customer pakai Arab/Inggris, balas dengan bahasa itu).
- Gaya chat WhatsApp: singkat (1–4 kalimat), ramah, boleh 1 emoji. Jangan pakai judul/heading. Boleh *tebal* seperlunya.
- Pahami kebutuhannya, sebut layanan yang cocok, lalu tanyakan data yang kurang. Maksimal 2–3 pertanyaan sekali kirim.
- Jangan pernah menyebut harga, tarif, kurs, atau diskon. Kalau ditanya harga: bilang admin akan kirim penawaran setelah datanya lengkap.
- Jangan konfirmasi booking/ketersediaan/jadwal pasti. Jangan mengarang info yang tidak ada di atas.
- Kalau ditanya apakah kamu bot/AI: jawab jujur kamu asisten otomatis, dan admin akan melanjutkan.
- Salam dibalas salam (Wa'alaikumussalam...).
- Kalau chat tidak ada hubungannya dengan layanan (salah sambung, spam, iklan, obrolan pribadi): balas singkat dan sopan, atau reply null kalau tidak perlu dibalas.

## KAPAN DITERUSKAN KE ADMIN (handoff = true)
- Data utama sudah cukup untuk dibuatkan penawaran, ATAU
- Customer minta harga / mau booking / mau bayar, ATAU
- Komplain, darurat, butuh hari ini, ATAU
- Pertanyaan di luar pengetahuanmu, ATAU customer minta bicara dengan admin.
Saat handoff, kasih tahu customer dengan sopan bahwa admin akan segera menghubungi.

## FORMAT JAWABAN (WAJIB, hanya JSON, tanpa teks lain)
{"reply": "teks balasan untuk customer, atau null",
 "handoff": true/false,
 "business": "SupirIndo | PT. MII | Muthowif | Pindah Kafil | Tamis | Kelas Muthowif | Jastip | digiKSA | Lainnya",
 "summary": "ringkasan kebutuhan customer + data yang sudah didapat, untuk admin (1–3 baris)"}`;
}

/** history: [{role:'user'|'assistant', text}] urut lama → baru */
export async function respond(history) {
  if (!client) return null;
  const msgs = [];
  for (const h of history) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + h.text;
    else msgs.push({ role, content: h.text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;

  const res = await client.messages.create({
    model: env.CHAT_MODEL, max_tokens: 800, system: systemPrompt(), messages: msgs,
  });
  const raw = res.content.map(b => b.text || '').join('');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const out = JSON.parse(json);
  return {
    reply: typeof out.reply === 'string' && out.reply.trim() ? out.reply.trim() : null,
    handoff: !!out.handoff,
    business: String(out.business || 'Lainnya'),
    summary: String(out.summary || ''),
  };
}
