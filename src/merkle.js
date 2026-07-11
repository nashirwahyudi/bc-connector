// merkle.js — Lapisan roadmap: anchoring Merkle root ke blockchain publik.
//
// Daun (leaf) pohon = entryHash dari hash-chain ledger — jadi yang di-anchor
// ke chain publik adalah rantai internal itu sendiri. Dua lapisan kepercayaan
// tersambung: hash-chain (MVP) -> Merkle root -> kontrak AuditAnchor.
//
// Hash pasangan memakai keccak256 (sorted-pair) agar identik dengan
// AuditAnchor.verifyProof di Solidity, sehingga auditor eksternal bisa
// memverifikasi on-chain tanpa memercayai server SinergiDesa.

const { ethers } = require("ethers");

/** Hash pasangan node, diurutkan — sama persis dengan verifier Solidity. */
function hashPair(a, b) {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/** Bangun pohon dari array leaf (entryHash 32-byte hex). */
function buildTree(leaves) {
  if (leaves.length === 0) throw new Error("Tidak bisa membangun pohon dari 0 leaf");
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 < prev.length) next.push(hashPair(prev[i], prev[i + 1]));
      else next.push(prev[i]); // node ganjil dipromosikan
    }
    layers.push(next);
  }
  return { root: layers[layers.length - 1][0], layers };
}

/** Bukti Merkle (sibling bottom-up) untuk leaf pada indeks tertentu. */
function getProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sib < layer.length) proof.push(layer[sib]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verifikasi off-chain (cermin logika Solidity). */
function verifyProof(leaf, proof, root) {
  let computed = leaf;
  for (const p of proof) computed = hashPair(computed, p);
  return computed.toLowerCase() === root.toLowerCase();
}

module.exports = { hashPair, buildTree, getProof, verifyProof };
