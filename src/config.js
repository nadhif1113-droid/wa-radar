// ============================================================
//  PENGATURAN RADAR — bagian yang boleh lu ubah sendiri
// ============================================================
import 'dotenv/config';

export const env = {
  OWNER_NUMBER: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''), // WA utama lu (penerima digest)
  BOT_NUMBER: (process.env.BOT_NUMBER || '').replace(/\D/g, ''),     // nomor kedua yang dipasang bot
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  DIGEST_TIMES: (process.env.DIGEST_TIMES || '07:00,19:00').split(',').map(s => s.trim()).filter(Boolean),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Riyadh',
  ALERT_MINE: (process.env.ALERT_MINE || 'true') === 'true',          // kirim lead layanan lu langsung
  RETAIN_DAYS: Number(process.env.RETAIN_DAYS || 30),
  DB_PATH: process.env.DB_PATH || './data/radar.db',
};

// Kategori. mine:true = layanan yang lu jual → lead-nya dikirim langsung (alert real-time).
// Tambah/kurangi kata kunci sesuka lu (huruf kecil semua).
export const CATEGORIES = [
  { id: 'transport', label: 'Tebengan / transport / bandara', mine: true,
    kw: ['bareng', 'tebeng', 'nebeng', 'bandara', 'airport', ' t1', 'terminal haji', 'jemput', 'antar ke', 'mobil', 'sopir', 'supir', 'driver', 'taxi', 'taksi', 'gmc', 'staria', 'hiace', 'bus ke', 'ke mekkah', 'ke makkah', 'ke madinah', 'ke jeddah', 'ke thaif', 'ke taif'] },
  { id: 'muthowif', label: 'Muthowif / guide / handling', mine: true,
    kw: ['muthow', 'mutow', 'mutaw', 'muthaw', 'mutowif', 'tour leader', 'guide', 'handling', 'bimbingan umroh', 'bimbingan umrah', 'city tour', 'ziarah', 'pendamping', 'mendampingi'] },
  { id: 'visa', label: 'Visa / iqomah / exit / kafil', mine: true,
    kw: ['visa', 'exit', 'iqomah', 'iqamah', 'kafil', 'kafalah', 'naql', 'jawazat', 'muqeem', 'absher', 'istidhofah', 'istidhafah', 'multiple entry', 'perpanjang'] },
  { id: 'tamis', label: 'Tamis / tukar uang', mine: true,
    kw: ['tamis', 'tames', 'kurs', 'tukar', 'rupiah', 'riyal ke', 'transfer ke indo'] },
  { id: 'bagasi', label: 'Bagasi / jastip / titip', mine: true,
    kw: ['bagasi', 'jastip', 'titip', 'nitip', 'koper', 'kargo', 'cargo', 'ekspedisi', 'expedisi'] },
  { id: 'tasreh', label: 'Tasreh Raudhah', mine: false,
    kw: ['tasreh', 'tasrih', 'raudh', 'raudah', 'rauda', 'raudo', 'rawdah', 'roudhoh', 'booking raud'] },
  { id: 'hunian', label: 'Dar / syuqqah / hotel', mine: false,
    kw: ['dar ', 'daar', 'syuq', 'suqq', 'kamar', 'apart', 'sakan', 'hotel', 'mafrusy', 'kontrakan', 'kos '] },
  { id: 'tiket', label: 'Tiket pesawat / kereta', mine: false,
    kw: ['tiket', 'pesawat', 'saudia', 'miles', 'void', 'refund', 'flight', 'kereta', 'hhr'] },
  { id: 'makanan', label: 'Makanan / nasi box / catering', mine: false,
    kw: ['nasi box', 'nasi', 'catering', 'albaik', 'al baik', 'makanan', 'masakan', 'snack box', 'prasmanan'] },
  { id: 'pijat', label: 'Pijat / urut / bekam', mine: false,
    kw: ['pijat', 'pijet', 'pijit', 'urut', 'bekam', 'refleksi'] },
  { id: 'medis', label: 'Obat / medis', mine: false,
    kw: ['obat', 'sakit', 'rumah sakit', 'dokter', 'klinik', 'apotek', 'saidaliyah'] },
  { id: 'jasa', label: 'Jasa harian (jahit, cukur, servis, gas)', mine: false,
    kw: ['jahit', 'cukur', 'servis', 'service', 'tukang', 'gas ', 'laundry', 'reparasi', 'benerin'] },
  { id: 'loker', label: 'Loker / tenaga kerja', mine: false,
    kw: ['loker', 'lowongan', 'dibutuhkan', 'gaji', 'khaddamah', 'pekerja', 'freelance'] },
];

// Tanda orang NANYA / BUTUH sesuatu (calon pembeli)
export const ASK_WORDS = ['ada yg tau', 'ada yang tau', 'ada yg tahu', 'ada yang tahu', 'ada yg punya', 'ada yang punya',
  'ada yg bisa', 'ada yang bisa', 'ada yg mau', 'ada yang mau', 'ada yg lagi', 'ada yang lagi', 'mohon info', 'minta info',
  'info dong', 'butuh', 'dibutuhkan', 'dicari', 'nyari', 'cari barengan', 'mencari', 'mau tanya', 'izin tanya', 'ijin tanya',
  'numpang tanya', 'adakah', 'apakah ada', 'dimana', 'di mana', 'rekomendasi', 'recommend', 'kenalan', 'siapa yg', 'siapa yang'];

// Tanda orang JUALAN (penjual / iklan)
export const SELL_WORDS = ['hub:', 'hubungi', 'wa.me', 'harga', 'promo', 'ready', 'jual', 'open po', 'open order', 'order',
  'diskon', 'chat.whatsapp.com', 'reservasi', 'tersedia', 'melayani', 'kami siap', 'kami menyediakan', 'menerima',
  'pemesanan', 'best price', 'termurah', 'terpercaya', 'amanah', 'start ', 'mulai dari', 'per pax', '/pax', 'issued',
  'dibuka', 'slot', 'stok', 'stock', 'fast respon', 'fast response', 'bagi yang butuh', 'bagi yg butuh',
  'bagi yang membutuhkan', 'bagi yg membutuhkan', 'yang membutuhkan', 'yg membutuhkan', 'silahkan japri', 'silakan japri',
  'monggo', 'langsung japri', 'cocok buat', 'cocok untuk', 'bisa langsung', 'pnr', 'ahlan yg butuh', 'ahlan yang butuh',
  'merapat', 'available seat', 'seat available'];

// Ajakan / obrolan yang sering ketangkep sebagai pertanyaan
export const CHAT_WORDS = ['ayo merapat', 'yuk merapat', 'ayo ikut', 'yuk ikut', 'yang mau ikut kajian', 'barakallahu fiik',
  'jazakallah', 'syukron', 'aamiin', 'masya allah', 'masyaallah'];

// Tanda URGENT (butuh cepat)
export const URGENT_WORDS = ['sekarang', 'skrg', 'hari ini', 'malam ini', 'siang ini', 'sore ini', 'pagi ini', 'besok pagi',
  'urgent', 'segera', 'darurat', 'asap', 'secepatnya', 'saat ini'];

// Tanda INFO penting (bukan iklan)
export const INFO_WORDS = ['razia', 'pengumuman', 'peraturan', 'aturan baru', 'kebijakan', 'mulai berlaku', 'update visa',
  'kabar', 'hati-hati', 'hati hati', 'waspada', 'penipuan', 'penipu', 'mati listrik', 'listrik mati', 'sinyal', 'ditutup',
  'dibuka kembali', 'jadwal', 'kemenag', 'kbri', 'kjri', 'nusuk', 'maktab', 'denda', 'mukhalafah', 'tilang', 'linglung', 'hilang'];
