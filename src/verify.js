// verify.js — verifikasi dua tingkat, sesuai dua lapisan kepercayaan di deck:
//
//   Tingkat 1 (MVP)     : integritas hash-chain ledger — lokal, tanpa blockchain.
//   Tingkat 2 (Roadmap) : bukti Merkle terhadap root yang ter-anchor on-chain —
//                         auditor eksternal tidak perlu memercayai server kita.
//
// Pemakaian:
//   node src/verify.js            -> cek seluruh rantai (Tingkat 1)
//   node src/verify.js <seq>      -> cek satu entri (Tingkat 1 + 2 jika sudah di-anchor)

const ledger = require("./ledger");
// dotenv/ethers/merkle dimuat lambat (lazy) — Tingkat 1 berjalan tanpa
// dependensi apa pun; Tingkat 2 baru memerlukan `npm install`.

const ABI = [
  "function getRoot(uint256 batchId) external view returns (bytes32 merkleRoot, uint64 timestamp, address anchoredBy)",
];

async function verifyAll() {
  const res = ledger.verifyChain();
  if (res.valid) {
    console.log(`✅ Hash-chain UTUH — ${res.totalEntries} entri, tidak ada manipulasi.`);
  } else {
    console.log(`❌ Hash-chain PUTUS — terdeteksi manipulasi:`);
    for (const p of res.problems) console.log(`   entri #${p.seq}: ${p.issue}`);
  }
  return res;
}

async function verifyEntry(seq) {
  // ---- Tingkat 1: hash-chain ----
  const chain = ledger.verifyChain();
  const chainOkForEntry = !chain.problems.some((p) => p.seq === seq);
  console.log(
    chain.valid
      ? "Tingkat 1 (hash-chain): ✅ seluruh rantai utuh"
      : `Tingkat 1 (hash-chain): ${chainOkForEntry ? "⚠️ entri ini utuh tapi rantai lain putus" : "❌ entri ini dimanipulasi"}`
  );

  // ---- Tingkat 2: on-chain ----
  const entry = ledger.getEntry(seq);
  if (!entry) throw new Error(`Entri #${seq} tidak ditemukan`);
  const batch = ledger.getBatchForEntry(seq);
  if (!batch) {
    console.log("Tingkat 2 (on-chain): entri belum masuk batch anchoring — jalankan anchor.js dulu.");
    return { level1: chainOkForEntry && chain.valid, level2: null };
  }

  require("dotenv").config();
  const { ethers } = require("ethers");
  const { buildTree, getProof, verifyProof } = require("./merkle");

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);
  const [onChainRoot, timestamp] = await contract.getRoot(batch.batchId);
  if (onChainRoot === ethers.ZeroHash) throw new Error(`Batch ${batch.batchId} tidak ditemukan on-chain`);

  // Bangun ulang pohon dari kondisi database SAAT INI (entryHash dihitung ulang)
  const batchEntries = ledger.getEntriesBySeqs(batch.seqs);
  const leaves = batchEntries.map((e) => ledger.sha256hex(ledger.canonical(e)));
  const { root: recomputedRoot, layers } = buildTree(leaves);

  const leafIndex = batch.seqs.indexOf(seq);
  const proof = getProof(layers, leafIndex);
  const valid =
    verifyProof(leaves[leafIndex], proof, onChainRoot) &&
    recomputedRoot.toLowerCase() === onChainRoot.toLowerCase();

  console.log(
    valid
      ? `Tingkat 2 (on-chain): ✅ cocok dengan root ter-anchor (${new Date(Number(timestamp) * 1000).toISOString()}, tx ${batch.txHash})`
      : `Tingkat 2 (on-chain): ❌ TIDAK cocok — data diubah setelah anchoring!\n   root on-chain : ${onChainRoot}\n   root hitung   : ${recomputedRoot}`
  );

  return {
    level1: chainOkForEntry && chain.valid,
    level2: valid,
    proof,        // bisa diserahkan ke auditor untuk verifikasi mandiri via kontrak
    batchId: batch.batchId,
    txHash: batch.txHash,
  };
}

if (require.main === module) {
  const arg = process.argv[2];
  const run = arg ? verifyEntry(parseInt(arg, 10)) : verifyAll();
  run
    .then((r) => process.exit(r.valid === false || r.level1 === false || r.level2 === false ? 2 : 0))
    .catch((err) => {
      console.error("Verifikasi error:", err.message);
      process.exit(1);
    });
}

module.exports = { verifyAll, verifyEntry };
