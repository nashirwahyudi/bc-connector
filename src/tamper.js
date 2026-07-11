// tamper.js — sengaja mengubah kuantitas satu entri di ledger.json untuk
// demo "pembukuan dimanipulasi" saat pitch. Setelah ini, verify.js harus ❌.
// Pemakaian: node src/tamper.js <seq> <kuantitasKgBaru>

const fs = require("fs");
const { LEDGER_FILE } = require("./ledger");

const [seqArg, newQty] = process.argv.slice(2);
if (!seqArg || !newQty) {
  console.error("Pemakaian: node src/tamper.js <seq> <kuantitasKgBaru>");
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));
const entry = store.entries.find((e) => e.seq === parseInt(seqArg, 10));
if (!entry) {
  console.error(`Entri #${seqArg} tidak ditemukan`);
  process.exit(1);
}

console.log(`Manipulasi: entri #${entry.seq} (${entry.aksi} ${entry.komoditas}) kuantitas ${entry.kuantitasKg} -> ${newQty} kg`);
entry.kuantitasKg = parseInt(newQty, 10);
fs.writeFileSync(LEDGER_FILE, JSON.stringify(store, null, 2));
console.log(`Selesai. Jalankan: node src/verify.js ${entry.seq}   (harus terdeteksi ❌)`);
