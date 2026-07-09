# SinergiDesa PoC — Parsing Engine + Ledger Hash-Chain + Anchoring

PoC yang diselaraskan dengan deck v2. Setiap komponen memetakan langsung ke slide:

| Komponen | File | Slide deck |
|---|---|---|
| Text Parsing Engine (fuzzy + konfirmasi YA/TIDAK) | `src/parser.js` | Slide 4 (Pilar 1) |
| Ledger append-only + hash-chain (MVP un-tamperable) | `src/ledger.js` | Slide 7 & 10 (Pilar 3) |
| Anchoring Merkle root ke chain publik (roadmap, opsional) | `src/merkle.js`, `src/anchor.js`, `contracts/AuditAnchor.sol` | Slide 7 ("blockchain hanya untuk ledger/audit trail") |
| Verifikasi dua tingkat | `src/verify.js` | Slide 7 & 12 |
| Simulasi pesan masuk + registrasi anggota (KYC ringan) | `src/demo.js` | Slide 10 & 12 |
| Demo manipulasi pembukuan | `src/tamper.js` | Slide 12 |
| REST API untuk dashboard | `src/server.js` | Slide 10 ("Dashboard Web") |

## Dua lapisan kepercayaan (sesuai keputusan deck)

```
pesan teks ─► parser (fuzzy) ─► LEDGER HASH-CHAIN          ◄── MVP hackathon
                                 entri #n menyimpan hash #n-1
                                       │  (batch per jam/hari)
                                       ▼
                                 Merkle root ─► AuditAnchor  ◄── Roadmap (opsional)
                                 di Sepolia (PoC) / L2 (produksi)
```

- **Tingkat 1 — hash-chain (tanpa blockchain):** cukup untuk klaim "un-tamperable" di depan juri. `verify.js` menghitung ulang seluruh rantai; satu entri diubah = rantai putus.
- **Tingkat 2 — anchoring (roadmap):** leaf pohon Merkle = hash entri rantai itu sendiri, sehingga yang di-anchor adalah rantai internal. Auditor eksternal (HIMBARA, dinas) bisa memverifikasi lewat kontrak `verifyProof()` **tanpa memercayai server SinergiDesa** — menjawab "krisis kepercayaan" Slide 2. Berjalan otomatis via cron, tanpa interaksi manusia.

## Kepatuhan (penting untuk pitch)

- **Bukan pembayaran.** Tidak ada dana pengguna yang menyentuh blockchain; ETH testnet hanya gas untuk mencatat sidik jari audit. Pembayaran riil 100% Rupiah via mitra PJP berlisensi BI (UU 7/2011; PBI 18/40/PBI/2016; PBI 23/6/PBI/2021) — konsisten dengan Slide 7.
- **Format audit kanonik.** `canonical()` di `ledger.js` adalah format resmi yang di-hash (field tetap, versi `v:1`). Dokumentasikan; jangan diubah retroaktif.
- **Anchoring membuktikan data tidak diubah _setelah_ dicatat** — bukan kebenaran saat input. Kebenaran input dijaga dual-witness + bukti foto/geotag (Slide 7), di luar scope PoC ini.

## Menjalankan demo (Tingkat 1 — tanpa blockchain, tanpa setup)

```bash
npm install
node src/demo.js        # pesan masuk (termasuk typo KRIM#BELERNG) -> ledger
node src/verify.js      # ✅ rantai utuh
node src/tamper.js 2 999
node src/verify.js      # ❌ manipulasi terdeteksi di entri #2
```

Ini saja sudah cukup untuk demo hackathon sesuai scope Slide 12.

## REST API (backend untuk dashboard)

```bash
node src/server.js          # port 3000, TANPA npm install (Tingkat 1 penuh)
PORT=8080 node src/server.js
```

CORS terbuka (`*`) untuk dev dashboard — batasi origin di produksi. Semua respons JSON.

| Method & Path | Fungsi |
|---|---|
| `GET /api/health` | liveness check |
| `POST /api/anggota` | daftarkan anggota `{nomorHp, nama, koperasiId}` (KYC ringan oleh pengurus) |
| `GET /api/anggota` | daftar anggota |
| `POST /api/messages` | pesan masuk `{dari, teks}` → parser → ledger. Menangani alur konfirmasi: typo berat → respons `needsConfirmation:true`; kirim `{dari, teks:"YA"}` untuk mencatat, `"TIDAK"` untuk batal. Nomor tak terdaftar / format salah → `422` |
| `GET /api/entries` | entri ledger; filter `?koperasiId=&aksi=&komoditas=`, paginasi `?limit=&offset=` |
| `GET /api/entries/:seq` | satu entri |
| `GET /api/verify` | verifikasi seluruh hash-chain (Tingkat 1) — `{valid, problems[]}` |
| `GET /api/verify/:seq` | verifikasi satu entri: `level1` (hash-chain) + `level2` (on-chain, bila sudah di-anchor & deps terpasang) |
| `POST /api/anchor` | jalankan anchoring batch sekarang (perlu `npm install` + `.env`; tanpa itu → `503` dengan petunjuk) |
| `GET /api/batches` | daftar batch ter-anchor (root, txHash, seqs) |
| `GET /api/stats` | ringkasan dashboard: total entri, integritas rantai, agregat per aksi/komoditas/koperasi, sinyal kebutuhan (BUTUH) |

Contoh untuk dashboard:

```bash
curl -X POST localhost:3000/api/messages -H 'Content-Type: application/json' \
  -d '{"dari":"+6281200000003","teks":"KIRIM#BELERANG#5TON#TRUK123"}'
curl localhost:3000/api/stats
curl "localhost:3000/api/entries?koperasiId=KOP-DESA-B&limit=10"
```

Integrasi WhatsApp nanti: webhook WhatsApp Cloud API tinggal meneruskan `{dari, teks}` ke `POST /api/messages` dan mengirim field `reply` kembali ke pengguna. Catatan PoC: antrean konfirmasi YA/TIDAK disimpan in-memory (hilang saat restart) — pindahkan ke DB/Redis dengan TTL 24 jam di produksi.

## Mengaktifkan Tingkat 2 (anchoring ke Sepolia)

1. Deploy `contracts/AuditAnchor.sol` via Remix ke Sepolia (satu kali).
2. `cp .env.example .env`, isi RPC_URL (Infura/Alchemy), PRIVATE_KEY wallet server, CONTRACT_ADDRESS. Danai wallet dengan Sepolia ETH gratis dari faucet.
3. `node src/anchor.js` — atau jadwalkan via cron: `0 * * * * node src/anchor.js`.
4. `node src/verify.js <seq>` kini menampilkan Tingkat 1 + Tingkat 2, lengkap dengan tx hash yang bisa ditunjukkan di sepolia.etherscan.io.

Produksi: pindah ke L2 (Polygon/Arbitrum/Base — biaya sen per anchor) atau chain permissioned; testnet bisa di-reset sehingga hanya untuk PoC.

## Format pesan yang didukung parser

```
KIRIM#KOMODITAS#KUANTITAS#ARMADA    KIRIM#BELERANG#5TON#TRUK123
JUAL#KOMODITAS#KUANTITAS#HARGA      JUAL#GABAH#2TON#RP12000
TERIMA#KOMODITAS#KUANTITAS#OK       TERIMA#PUPUK#500KG#OK
BUTUH#KOMODITAS#KUANTITAS           BUTUH#PUPUK#500KG
```

Toleransi typo: jarak Levenshtein ≤2 diterima otomatis (`KRIM`, `BELERNG`); ≤3 memicu balasan konfirmasi "Apakah maksud Anda ...? Balas YA/TIDAK" (gratis dalam jendela 24 jam WhatsApp). Kuantitas dinormalisasi ke kg (`5TON`, `5 TON`, `500KG`); harga ke rupiah (`RP12000`, `RP 12.000`). Nomor tak terdaftar ditolak (registrasi via pengurus).

## Yang sengaja TIDAK ada di PoC ini (sesuai Slide 12: roadmap, bukan demo)

Integrasi WhatsApp Cloud API riil (demo memakai simulasi pesan), escrow/split settlement PJP (mock terpisah via sandbox payment gateway), matching engine return-load, credit scoring, dashboard, SMS fallback.
