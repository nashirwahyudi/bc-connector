// demo.js — simulasi alur MVP Slide 12: pesan masuk -> parsing + fuzzy ->
// balasan konfirmasi -> tercatat di ledger hash-chain.
// (Di produksi, "pesan masuk" datang dari webhook WhatsApp Cloud API / SMS gateway.)
//
// Jalankan: node src/demo.js

const { parseMessage } = require("./parser");
const ledger = require("./ledger");

function main() {
  // Anggota & koperasi disamakan dengan data dummy frontend (mockData.ts)
  // supaya cerita demo konsisten lintas dashboard <-> ledger on-chain.
  ledger.registerAnggota("+6281300000001", "Budi Santoso",  "Kop. Sumberrejo"); // Staf Logistik
  ledger.registerAnggota("+6281300000002", "Slamet Riyadi", "Kop. Argosari");   // Staf Logistik
  ledger.registerAnggota("+6281300000003", "Siti Rahma",    "Kop. Argosari");   // Administrasi
  ledger.registerAnggota("+6281300000004", "Edi Santoso",   "Kop. Tirtomulyo");
  console.log("Anggota terdaftar: 4 (3 koperasi)\n");

  // Pesan masuk — nilai (komoditas/kuantitas/harga) dipilih agar cocok
  // dengan transaksi & escrow yang sama di frontend (mockData.ts), plus
  // contoh typo (fuzzy) dan nomor tak terdaftar untuk uji parser.
  const incoming = [
    // ESC-2292: Belerang 5 ton, Sumberrejo -> Argosari, Rp 18,5 jt (act-3: sengketa escrow)
    { dari: "+6281300000001", teks: "KIRIM#BELERANG#5TON#N8412UT" },
    // ESC-2291: Gabah 2 ton, Sumberrejo -> Argosari, Rp 24 jt
    { dari: "+6281300000001", teks: "JUAL#GABAH#2TON#RP12000" },
    // ESC-2293: Pupuk organik 800 kg, Sumberrejo -> Tirtomulyo, Rp 6,4 jt
    { dari: "+6281300000004", teks: "TERIMA#PUPUK#800KG#OK" },
    // TRX-0712-019: Jagung 800 kg @ Rp5.500, handler Slamet Riyadi, Kop. Argosari
    { dari: "+6281300000002", teks: "JUAL#JAGUNG#800KG#RP5500" },
    // TRX-0712-021: Gabah 1.100 kg @ Rp7.200, handler Siti Rahma, Kop. Argosari
    { dari: "+6281300000003", teks: "JUAL#GABAH#1100KG#RP7200" },
    // sinyal demand sensing (Pupuk) untuk dashboard "Kebutuhan"
    { dari: "+6281300000002", teks: "BUTUH#PUPUK#500KG" },
    { dari: "+6281300000001", teks: "KRIM#BELERNG#3TON#N8412UT" },   // typo -> tetap dikenali
    { dari: "+6281300000002", teks: "JUAL#GABAH#2 TON#RP 12.000" },  // spasi/format -> dinormalisasi
    { dari: "+6289900000000", teks: "JUAL#KOPI#1TON#RP80000" },      // nomor TIDAK terdaftar -> ditolak
    { dari: "+6281300000003", teks: "HALO ADMIN" },                   // bukan format -> balasan bantuan
  ];

  const anggota = ledger.getAnggota();
  for (const msg of incoming) {
    console.log(`📱 ${msg.dari}: "${msg.teks}"`);
    const res = parseMessage(msg.teks, msg.dari, anggota);
    if (res.ok) {
      const entry = ledger.append(res.entry);
      console.log(`   ↳ balasan: ${res.reply}`);
      console.log(`   ↳ ledger : entri #${entry.seq}, hash ${entry.entryHash.slice(0, 18)}..., prev ${entry.prevHash.slice(0, 18)}...`);
    } else if (res.needsConfirmation) {
      console.log(`   ↳ balasan: ${res.reply}`);
      console.log(`   ↳ (demo: pengguna membalas "YA" -> entri dicatat)`);
      const entry = ledger.append(res.entry);
      console.log(`   ↳ ledger : entri #${entry.seq}, hash ${entry.entryHash.slice(0, 18)}...`);
    } else {
      console.log(`   ↳ balasan: ${res.reply}`);
    }
    console.log();
  }

  const chain = ledger.verifyChain();
  console.log(`Rantai ledger: ${chain.totalEntries} entri, integritas: ${chain.valid ? "✅ UTUH" : "❌ PUTUS"}`);
  console.log("\nLangkah berikutnya:");
  console.log("  node src/verify.js          -> verifikasi hash-chain (Tingkat 1)");
  console.log("  node src/anchor.js          -> anchor batch ke Sepolia (Tingkat 2, perlu .env)");
  console.log("  node src/tamper.js 2 999    -> manipulasi entri #2, lalu verify lagi (harus ❌)");
}

main();
