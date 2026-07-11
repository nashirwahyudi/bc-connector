// anchor.js — Lapisan roadmap: anchoring otomatis batch entri ledger ke chain
// publik (PoC: testnet Sepolia). Berjalan tanpa interaksi manusia (cron).
//
// PENTING (kepatuhan, Slide 7): ini BUKAN pembayaran. Tidak ada dana pengguna
// yang menyentuh blockchain. ETH testnet hanya "gas" untuk mencatat sidik jari
// audit; semua pembayaran riil tetap Rupiah via mitra PJP berlisensi BI.

require("dotenv").config();
const { ethers } = require("ethers");
const { buildTree } = require("./merkle");
const ledger = require("./ledger");

const ABI = [
  "function anchorRoot(uint256 batchId, bytes32 merkleRoot) external",
  "function getRoot(uint256 batchId) external view returns (bytes32, uint64, address)",
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

const MAX_RETRIES = 3;

async function anchorPendingBatch() {
  const entries = ledger.getUnanchored();
  if (entries.length === 0) {
    console.log(`[${new Date().toISOString()}] Tidak ada entri baru — lewati.`);
    return null;
  }

  // Leaf = entryHash dari hash-chain — rantai internal yang di-anchor.
  const leaves = entries.map((e) => e.entryHash);
  const { root } = buildTree(leaves);
  const batchId = ledger.nextBatchId();

  console.log(`Batch ${batchId}: ${entries.length} entri, root ${root}`);

  let receipt;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tx = await contract.anchorRoot(batchId, root);
      console.log(`  Tx terkirim ${tx.hash}, menunggu konfirmasi...`);
      receipt = await tx.wait(1);
      break;
    } catch (err) {
      console.error(`  Percobaan ${attempt} gagal: ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }

  // Simpan referensi audit. Urutan seq = urutan leaf — penting untuk bukti.
  ledger.markAnchored({
    batchId,
    root,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    seqs: entries.map((e) => e.seq),
  });

  console.log(`  Batch ${batchId} ter-anchor di blok ${receipt.blockNumber} (tx ${receipt.hash})`);
  return { batchId, root, txHash: receipt.hash };
}

// Jadwalkan via cron, mis. tiap jam:
//   0 * * * *  cd /srv/sinergidesa && node src/anchor.js >> anchor.log 2>&1
if (require.main === module) {
  anchorPendingBatch()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Anchoring gagal:", err);
      process.exit(1);
    });
}

module.exports = { anchorPendingBatch };
