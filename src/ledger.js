// ledger.js — Pilar 3 (MVP): Ledger append-only + hash-chain.
// Sesuai keputusan deck v2 Slide 7: "append-only ledger + hash-chain sederhana
// (setiap entri menyimpan hash entri sebelumnya)" — dipertahankan di depan juri
// tanpa biaya & kompleksitas blockchain penuh.
//
// entryHash = SHA-256( canonical(entri) + prevHash )
// Mengubah satu entri lama membuat hash-nya berubah -> seluruh rantai
// setelahnya putus -> manipulasi langsung terdeteksi.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LEDGER_FILE = path.join(__dirname, "..", "data", "ledger.json");
const GENESIS = "0x" + "0".repeat(64);

function load() {
  if (!fs.existsSync(LEDGER_FILE)) {
    return { entries: [], batches: [], anggota: {} };
  }
  return JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));
}

function save(store) {
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(store, null, 2));
}

/**
 * Serialisasi kanonik entri — urutan field TETAP.
 * Format ini adalah "format audit" resmi: didokumentasikan, diberi versi,
 * dan tidak boleh diubah retroaktif (mengubahnya = memutus verifikasi lama).
 */
function canonical(e) {
  return JSON.stringify({
    v: 1,
    seq: e.seq,
    aksi: e.aksi,
    komoditas: e.komoditas,
    kuantitasKg: e.kuantitasKg,
    hargaRp: e.hargaRp ?? null,
    armada: e.armada ?? null,
    status: e.status ?? null,
    pengirim: e.pengirim,
    koperasiId: e.koperasiId,
    timestamp: e.timestamp,
    prevHash: e.prevHash,
  });
}

function sha256hex(s) {
  return "0x" + crypto.createHash("sha256").update(s).digest("hex");
}

/** Tambahkan entri tervalidasi (hasil parser) ke ujung rantai. */
function append(parsedEntry) {
  const store = load();
  const prev = store.entries[store.entries.length - 1];
  const entry = {
    ...parsedEntry,
    seq: store.entries.length + 1,
    timestamp: new Date().toISOString(),
    prevHash: prev ? prev.entryHash : GENESIS,
    batchId: null, // diisi saat anchoring (lapisan roadmap)
  };
  entry.entryHash = sha256hex(canonical(entry));
  store.entries.push(entry);
  save(store);
  return entry;
}

/**
 * Verifikasi integritas seluruh rantai (klaim MVP di depan juri).
 * Menghitung ulang hash setiap entri dan mengecek sambungan prevHash.
 */
function verifyChain() {
  const store = load();
  const problems = [];
  let prevHash = GENESIS;
  for (const e of store.entries) {
    if (e.prevHash !== prevHash) {
      problems.push({ seq: e.seq, issue: "prevHash tidak menyambung ke entri sebelumnya" });
    }
    const recomputed = sha256hex(canonical(e));
    if (recomputed !== e.entryHash) {
      problems.push({ seq: e.seq, issue: "isi entri berubah setelah dicatat", recomputed, stored: e.entryHash });
    }
    prevHash = e.entryHash;
  }
  return { valid: problems.length === 0, totalEntries: store.entries.length, problems };
}

// --- util untuk lapisan anchoring & demo ---
function getUnanchored() {
  return load().entries.filter((e) => e.batchId === null);
}
function nextBatchId() {
  return load().batches.length + 1;
}
function markAnchored({ batchId, root, txHash, blockNumber, seqs }) {
  const store = load();
  for (const e of store.entries) if (seqs.includes(e.seq)) e.batchId = batchId;
  store.batches.push({ batchId, root, txHash, blockNumber, seqs });
  save(store);
}
function getEntry(seq) {
  return load().entries.find((e) => e.seq === seq) || null;
}
function getBatchForEntry(seq) {
  return load().batches.find((b) => b.seqs.includes(seq)) || null;
}
function getEntriesBySeqs(seqs) {
  const store = load();
  return seqs.map((q) => store.entries.find((e) => e.seq === q));
}
function getAnggota() {
  return load().anggota;
}
function registerAnggota(nomorHp, nama, koperasiId) {
  const store = load();
  store.anggota[nomorHp] = { nama, koperasiId };
  save(store);
}

module.exports = {
  append, verifyChain, canonical, sha256hex, GENESIS,
  getUnanchored, nextBatchId, markAnchored,
  getEntry, getBatchForEntry, getEntriesBySeqs,
  getAnggota, registerAnggota,
  LEDGER_FILE,
};
