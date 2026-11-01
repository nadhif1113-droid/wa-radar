# 📡 Radar Group — Bot WA Penyaring Group

Bot ini **cuma membaca** group WhatsApp. Ke group, bot gak pernah kirim apa pun. Bot juga **gak pernah ngechat duluan** ke orang asing, cuma membalas chat yang masuk. Semua hasilnya dikirim ke WA utama lu:

- 🔔 **Alert langsung** begitu ada orang yang butuh layanan lu (tebengan/transport, muthowif, visa/iqomah, tamis, bagasi)
- 📋 **Digest otomatis jam 07:00 & 19:00**: isinya pertanyaan, kebutuhan, dan info penting. Iklan copy-paste dan media udah dibuang
- 📈 **Trend**: apa yang lagi paling dicari, apa yang paling banyak dijual, dan peluang yang penjualnya masih sedikit

Hasil tes pakai 8 export group lu: dari **17.295 pesan dalam 14 hari**, yang lolos cuma **192 pesan (1,1%)**.

---

## Konsep: 2 nomor

| Nomor | Tugas |
|---|---|
| **Nomor kedua** (bot) | Masuk ke semua group jualan/info. Dipasang ke bot sebagai "perangkat tertaut" |
| **Nomor utama** (lu) | **Keluar** dari group-group sampah tadi, jadi storage HP lega. Terima digest dari bot |

> ⚠️ Bot pakai library WhatsApp **tidak resmi** (Baileys). Selalu ada risiko nomor diblokir Meta. Makanya bot dipasang di **nomor kedua**, bukan nomor jualan utama lu. Bot ini cuma baca dan gak kirim ke group, jadi risikonya rendah, tapi tetap bukan nol.

---

## Setup dari HP (sekitar 15 menit, sekali saja)

### 1. Siapkan nomor kedua
- Aktifkan WhatsApp di nomor kedua (boleh WA Business, boleh di HP lain atau mode dual app).
- Masuk ke semua group yang mau dipantau pakai nomor itu.

### 2. Sewa VPS
Contoh pakai Hostinger, paket **KVM 1**:
- OS: **Ubuntu 24.04** (pilih yang polos, tanpa panel/aplikasi)
- Lokasi server: bebas
- Bikin **root password**, terus catat

### 3. Buka terminal
Di panel Hostinger: **VPS → Manage → Browser terminal**. Layar hitam yang muncul itu terminalnya.
(Kalau pakai penyedia lain, bisa pakai aplikasi **Termius** di HP: isi IP, user `root`, dan password.)

### 4. Install semuanya dengan 1 perintah
Copy-paste ini ke terminal, lalu tekan Enter:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nadhif1113-droid/wa-radar/main/setup.sh)
```
Script-nya bakal:
1. Pasang Node.js dan semua yang dibutuhkan
2. Nanya **nomor WA utama**, **nomor kedua**, dan API key Claude (boleh dikosongkan)
3. Nampilin **KODE PAIRING**. Di HP nomor kedua buka **WhatsApp → Perangkat tertaut → Tautkan perangkat → "Tautkan dengan nomor telepon saja"**, lalu masukkan kodenya
4. Nyalain bot 24 jam secara otomatis

Kalau berhasil, WA utama lu dapet pesan **"✅ Radar Group aktif!"**.

### Update bot nanti
Jalankan perintah yang sama di langkah 4. Data dan sambungan WA lu gak hilang.

Cek log: `pm2 logs radar` · Restart: `pm2 restart radar`

---

## Perintah (chat ke nomor bot dari WA utama lu)

| Ketik | Hasil |
|---|---|
| `menu` | Daftar perintah |
| `digest` | Rangkuman sejak digest terakhir |
| `leads` | Semua lead layanan lu 24 jam terakhir |
| `trend` | Yang paling dicari & dijual 7 hari + peluang |
| `grup` | Daftar group + skor "gak penting" |
| `mode 3 ignore` | Group no. 3 dicuekin (cocok buat Ben Thalib, Info Dar Makkah, UMROH INFO, GUIDE UMROH, UMROH SOCIETY) |
| `mode 5 alert` | Group no. 5: tiap pertanyaan langsung dikirim (cocok buat GET JOBS) |
| `cari tasreh` | Cari pesan penting yang ada kata "tasreh" |
| `harga` / `harga visa` | Harga pasar 7 hari / detail + penjual termurah |
| `status` | Cek bot hidup |

---

## 💹 Pantau harga pasar (otomatis)
Setiap iklan yang masuk ke group mana pun (termasuk group yang di-`ignore`) ditarik harganya: visa, hotel per tipe kamar, paket, tiket, handling, tasreh, siskopatuh, vaksin, BRN, kurs tamis, bus, nasi box, jastip, dll. Iklan yang di-copy-paste dihitung sebagai pengulangan, bukan penawaran baru.
- `harga`: median dan rentang wajar 7 hari terakhir, plus ▲▼ dibanding minggu lalu. Dikirim otomatis **tiap Sabtu 08:00**.
- `harga visa` / `harga hotel` / `harga handling` / `harga tasreh` / `harga kurs` / `harga paket` …: 5 penjual termurah lengkap dengan kontak, kutipan iklan, group, dan tanggal. Untuk hotel ada juga tabel quad per hotel.
Semua angka itu harga iklan, bukan harga deal. Data disimpan 120 hari.

## 💬 Auto-reply chat customer (nomor bisnis)
Kalau ada orang yang ngechat **duluan** ke nomor bot (misalnya dari iklan Meta), bot bakal:
1. Nunggu ~12 detik, karena customer sering ngirim beberapa pesan beruntun. Setelah itu bot menampilkan "sedang mengetik" dan baru membalas, dengan bahasa yang sama kayak customer.
2. Ngenalin layanan yang dimaksud (SupirIndo, PT. MII, muthowif, pindah kafil, tamis, jastip, digiKSA, paket padel). Sapaan pertama ke customer baru selalu menyebut daftar layanan, terus nanya data yang masih kurang.
3. **Gak nyebut harga atau kurs (kecuali yang ada di bagian "Harga yang BOLEH disebut", misalnya padel mulai 450 SAR), dan gak konfirmasi booking.** Kalau datanya udah cukup, atau customer minta harga, chat-nya **diteruskan ke WA utama lu** dengan ringkasan (🤝 CUSTOMER SIAP DILAYANI). Setelah itu bot diam 12 jam di chat tersebut.
4. Kalau lu bales manual dari HP nomor bisnis, bot **berhenti 24 jam** di chat itu.

Butuh API key Claude. Cara isinya: jalankan ulang perintah install, terus paste key-nya waktu diminta.
Perintah: `autoreply off` / `autoreply on` · `chat` (daftar customer per bisnis).
Isi pengetahuan bot ada di `bisnis.example.md`. Kalau mau diubah, salin jadi `bisnis.md` lalu edit.
Jam balas diatur lewat `REPLY_HOURS` di `.env` (default 24 jam).

## AI Claude (opsional, disarankan)
Tanpa AI, bot tetap jalan pakai saringan kata kunci. Kelemahannya, kadang iklan atau ajakan ikut ketangkep sebagai pertanyaan.
Dengan AI, tiap calon lead dicek ulang sama Claude: dipastikan beneran pertanyaan, diringkas, dan ditandai ⚡ kalau mendesak.
Caranya: bikin API key di **console.anthropic.com**, lalu isi `ANTHROPIC_API_KEY` di `.env` dan jalankan `pm2 restart radar`.
AI cuma dipakai untuk sekitar 2% pesan (calon lead), jadi biayanya kecil. Batas pemakaian bisa diatur di console.

## Atur kata kunci
Buka `src/config.js`:
- `CATEGORIES`: kategori + kata kuncinya. `mine: true` artinya layanan lu, jadi lead-nya dikirim langsung.
- `SELL_WORDS` / `ASK_WORDS`: tanda orang jualan vs orang nanya.

Setelah diubah, jalankan `pm2 restart radar`.

## Tes tanpa WhatsApp
Pakai file Export Chat (`_chat.txt`):
```bash
node tools/test-export.js "Nama Group=path/_chat.txt" "Group 2=path2/_chat.txt"
```

## Kalau ada masalah
- **Gak muncul kode pairing / gagal**: kosongkan `BOT_NUMBER` di `.env`, nanti yang muncul QR. Scan dari HP nomor kedua.
- **"Logout dari WhatsApp"**: jalankan `cd ~/wa-radar && pm2 stop radar && rm -rf auth`, lalu ulangi perintah install di langkah 4.
- **Data**: semua tersimpan di `data/radar.db`. Pesan penting dihapus otomatis setelah 30 hari. Media gak pernah diunduh.
