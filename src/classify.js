// Penyaring berbasis aturan (gratis, tanpa AI). AI dipakai belakangan hanya untuk calon lead.
import crypto from 'node:crypto';
import { CATEGORIES, ASK_WORDS, SELL_WORDS, INFO_WORDS, CHAT_WORDS, URGENT_WORDS } from './config.js';

export const isUrgent = text => URGENT_WORDS.some(w => text.toLowerCase().includes(w));

export function normalize(text) {
  return text.toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, c => c.normalize('NFKC'))   // huruf "bold unicode" iklan
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Hash longgar: 120 huruf pertama setelah dinormalisasi → menangkap iklan yang diedit sedikit
export function textHash(text) {
  const n = normalize(text).slice(0, 120);
  return crypto.createHash('sha1').update(n).digest('hex');
}

const has = (tl, words) => words.some(w => tl.includes(w));

export function categorize(text) {
  const tl = ' ' + text.toLowerCase() + ' ';
  let best = null, bestScore = 0;
  for (const c of CATEGORIES) {
    const score = c.kw.reduce((s, w) => s + (tl.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best ? best.id : 'lain';
}

// Kembalikan: 'kosong' | 'media' | 'iklan' | 'tanya' | 'info' | 'lain'
export function ruleKind(text, hasMedia) {
  const t = (text || '').trim();
  if (!t) return hasMedia ? 'media' : 'kosong';
  const tl = t.toLowerCase();
  if (t.length < 15) return 'kosong';                       // "up", "syukron", "aamiin", dll
  if (/this message was deleted|pesan ini telah dihapus|waiting for this message|menunggu pesan ini/.test(tl)) return 'kosong';
  const ask = has(tl, ASK_WORDS) || /\?\s*$/.test(t);
  const sell = has(tl, SELL_WORDS);
  const longAd = t.length > 500 || (t.match(/\n/g) || []).length > 12;
  const chat = has(tl, CHAT_WORDS) && !/\?/.test(t);
  if (ask && !sell && !longAd && !chat) return 'tanya';
  if (sell || longAd) return 'iklan';
  if (has(tl, INFO_WORDS)) return 'info';
  return 'lain';
}
