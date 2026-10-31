#!/usr/bin/env bash
# ============================================================
#  Installer Radar Group — jalankan di VPS Ubuntu:
#  bash <(curl -fsSL https://raw.githubusercontent.com/nadhif1113-droid/wa-radar/main/setup.sh)
# ============================================================
set -e
REPO="https://github.com/nadhif1113-droid/wa-radar.git"
DIR="$HOME/wa-radar"
say() { echo -e "\n\033[1;32m▶ $1\033[0m"; }

say "1/5 Pasang Node.js, git, pm2 (1-3 menit)…"
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
apt-get install -y git build-essential python3 >/dev/null
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null 2>&1
echo "Node $(node -v) siap."

say "2/5 Ambil kode bot…"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi
cd "$DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
echo "Kode siap di $DIR"

if [ ! -f .env ]; then
  say "3/5 Isi data (format internasional tanpa + dan spasi, contoh 966512345678 atau 6281234567890)"
  read -rp "Nomor WA UTAMA lu (penerima laporan): " OWNER
  read -rp "Nomor WA KEDUA (yang dipasang bot):   " BOTNUM
  read -rp "API key Claude (boleh kosong, Enter aja): " APIKEY
  cp .env.example .env
  sed -i "s/^OWNER_NUMBER=.*/OWNER_NUMBER=${OWNER//[^0-9]/}/" .env
  sed -i "s/^BOT_NUMBER=.*/BOT_NUMBER=${BOTNUM//[^0-9]/}/" .env
  sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${APIKEY}|" .env
else
  say "3/5 File .env sudah ada, dilewati (edit: nano $DIR/.env)"
fi

if [ ! -f auth/creds.json ]; then
  say "4/5 Sambungkan WhatsApp nomor kedua"
  echo "Sebentar lagi muncul KODE PAIRING 8 huruf."
  echo "Di HP nomor kedua: WhatsApp → Perangkat tertaut → Tautkan perangkat →"
  echo "'Tautkan dengan nomor telepon saja' → masukkan kodenya. Lalu tunggu, script lanjut sendiri."
  node src/bot.js --pair
else
  say "4/5 WhatsApp sudah tersambung, dilewati"
fi

say "5/5 Jalankan bot 24 jam…"
pm2 delete radar >/dev/null 2>&1 || true
pm2 start src/bot.js --name radar >/dev/null
pm2 save >/dev/null
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
pm2 save >/dev/null

echo -e "\n\033[1;32m✅ SELESAI! Bot jalan terus, termasuk setelah server restart.\033[0m"
echo "Chat 'menu' dari WA utama ke nomor bot untuk lihat perintah."
echo "Cek log: pm2 logs radar   ·   Restart: pm2 restart radar"
