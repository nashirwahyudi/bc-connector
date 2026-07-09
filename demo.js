// demo.js — simulasi alur MVP Slide 12: pesan masuk -> parsing + fuzzy ->
// balasan konfirmasi -> tercatat di ledger hash-chain.
// (Di produksi, "pesan masuk" datang dari webhook WhatsApp Cloud API / SMS gateway.)
//
// Jalankan: node src/demo.js

const { parseMessage } = require("./parser");
const ledger = require("./ledger");

function main() {
  // Registrasi anggota (KYC ringan oleh pengurus — Slide 10)
  ledger.registerAnggota("+6281200000001", "Pak Slamet", "KOP-DESA-A");   // desa agraris
  ledger.registerAnggota("+6281200000002", "Bu Rahmi",   "KOP-DESA-A");
  ledger.registerAnggota("+6281200000003", "Pak Yusuf",  "KOP-DESA-B");   // desa tambang
  console.log("Anggota terdaftar: 3 (2 koperasi)\n");

  // Pesan masuk — termasuk contoh typo (fuzzy) dan nomor tak terdaftar
  const incoming = [
    { dari: "+6281200000003", teks: "KIRIM#BELERANG#5TON#TRUK123" },
    { dari: "+6281200000001", teks: "JUAL#GABAH#2TON#RP12000" },
    { dari: "+6281200000002", teks: "TERIMA#PUPUK#500KG#OK" },
    { dari: "+6281200000001", teks: "BUTUH#PUPUK#500KG" },
    { dari: "+6281200000003", teks: "KRIM#BELERNG#3TON#TRUK99" },   // typo -> tetap dikenali
    { dari: "+6281200000002", teks: "JUAL#GABAH#2 TON#RP 12.000" }, // spasi/format -> dinormalisasi
    { dari: "+6289900000000", teks: "JUAL#KOPI#1TON#RP80000" },     // nomor TIDAK terdaftar -> ditolak
    { dari: "+6281200000001", teks: "HALO ADMIN" },                  // bukan format -> balasan bantuan
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
