// server.js — REST API SinergiDesa PoC (untuk dashboard).
// Dibangun di atas modul `http` bawaan Node — TANPA dependensi eksternal,
// sehingga Tingkat 1 (parser + ledger + verifikasi hash-chain) berjalan
// cukup dengan `node src/server.js`. Endpoint anchoring (Tingkat 2) baru
// memerlukan `npm install` + .env.
//
// Jalankan:  node src/server.js          (default port 3000)
//            PORT=8080 node src/server.js
//
// ============================ ENDPOINT ============================
// POST /api/anggota            daftarkan anggota {nomorHp, nama, koperasiId}
// GET  /api/anggota            daftar anggota terdaftar
// POST /api/messages           pesan masuk {dari, teks} -> parse -> ledger
//                              (alur konfirmasi YA/TIDAK ditangani otomatis)
// GET  /api/entries            entri ledger; filter ?koperasiId=&aksi=&komoditas=
//                              paginasi ?limit=&offset=
// GET  /api/entries/:seq       satu entri
// GET  /api/verify             verifikasi seluruh hash-chain (Tingkat 1)
// GET  /api/verify/:seq        verifikasi satu entri (Tingkat 1 + 2 bila ter-anchor)
// GET  /api/batches            daftar batch yang sudah di-anchor
// POST /api/anchor             jalankan anchoring batch sekarang (perlu .env)
// GET  /api/stats              ringkasan untuk dashboard
// GET  /api/health             liveness check
// ===================================================================

const http = require("http");
const { parseMessage } = require("./parser");
const ledger = require("./ledger");

const PORT = parseInt(process.env.PORT || "3000", 10);

// Konfirmasi YA/TIDAK yang menunggu balasan, per nomor HP (in-memory —
// cukup untuk PoC; di produksi simpan di DB/Redis dengan TTL 24 jam).
const pendingConfirmations = new Map();

// ---------- util http ----------
function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*", // longgar untuk dev dashboard; batasi di produksi
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) { req.destroy(); reject(new Error("Body terlalu besar")); }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Body bukan JSON valid")); }
    });
    req.on("error", reject);
  });
}

// ---------- handler ----------
const routes = {
  "GET /api/health": async () => [200, { status: "ok", time: new Date().toISOString() }],

  "POST /api/anggota": async (req) => {
    const { nomorHp, nama, koperasiId } = await readJsonBody(req);
    if (!nomorHp || !nama || !koperasiId) {
      return [400, { error: "Wajib: nomorHp, nama, koperasiId" }];
    }
    ledger.registerAnggota(nomorHp, nama, koperasiId);
    return [201, { registered: { nomorHp, nama, koperasiId } }];
  },

  "GET /api/anggota": async () => {
    const anggota = ledger.getAnggota();
    return [200, { count: Object.keys(anggota).length, anggota }];
  },

  // Titik masuk pesan — di produksi, webhook WhatsApp Cloud API / SMS gateway
  // memanggil endpoint ini setelah menerjemahkan payload-nya ke {dari, teks}.
  "POST /api/messages": async (req) => {
    const { dari, teks } = await readJsonBody(req);
    if (!dari || !teks) return [400, { error: "Wajib: dari (nomor HP), teks" }];

    const anggota = ledger.getAnggota();
    const upper = teks.trim().toUpperCase();

    // 1) Balasan konfirmasi untuk tebakan sebelumnya?
    if (pendingConfirmations.has(dari) && (upper === "YA" || upper === "TIDAK")) {
      const pending = pendingConfirmations.get(dari);
      pendingConfirmations.delete(dari);
      if (upper === "YA") {
        const entry = ledger.append(pending.entry);
        return [201, { recorded: true, entry, reply: `Tercatat: entri #${entry.seq}. Terima kasih.` }];
      }
      return [200, { recorded: false, reply: "Baik, dibatalkan. Silakan kirim ulang laporan Anda." }];
    }

    // 2) Pesan baru -> parser
    const result = parseMessage(teks, dari, anggota);
    if (result.ok) {
      const entry = ledger.append(result.entry);
      return [201, { recorded: true, entry, reply: result.reply }];
    }
    if (result.needsConfirmation) {
      pendingConfirmations.set(dari, { entry: result.entry, at: Date.now() });
      return [200, { recorded: false, needsConfirmation: true, reply: result.reply }];
    }
    return [422, { recorded: false, reply: result.reply }];
  },

  "GET /api/entries": async (req, url) => {
    let entries = ledger.getEntriesBySeqs(
      Array.from({ length: ledger.verifyChain().totalEntries }, (_, i) => i + 1)
    );
    const q = url.searchParams;
    if (q.get("koperasiId")) entries = entries.filter((e) => e.koperasiId === q.get("koperasiId"));
    if (q.get("aksi")) entries = entries.filter((e) => e.aksi === q.get("aksi").toUpperCase());
    if (q.get("komoditas")) entries = entries.filter((e) => e.komoditas === q.get("komoditas").toUpperCase());
    const total = entries.length;
    const offset = parseInt(q.get("offset") || "0", 10);
    const limit = Math.min(parseInt(q.get("limit") || "50", 10), 200);
    return [200, { total, offset, limit, entries: entries.slice(offset, offset + limit) }];
  },

  "GET /api/verify": async () => {
    const res = ledger.verifyChain();
    return [200, res];
  },

  "GET /api/batches": async () => {
    const { verifyAll } = require("./verify"); // hanya untuk konsistensi modul
    void verifyAll;
    const fs = require("fs");
    const store = fs.existsSync(ledger.LEDGER_FILE)
      ? JSON.parse(fs.readFileSync(ledger.LEDGER_FILE, "utf8"))
      : { batches: [] };
    return [200, { count: store.batches.length, batches: store.batches }];
  },

  "POST /api/anchor": async () => {
    try {
      const { anchorPendingBatch } = require("./anchor"); // perlu ethers + .env
      const result = await anchorPendingBatch();
      if (!result) return [200, { anchored: false, reply: "Tidak ada entri baru untuk di-anchor." }];
      return [201, { anchored: true, ...result }];
    } catch (err) {
      return [503, {
        error: "Anchoring tidak tersedia: " + err.message,
        hint: "Pastikan `npm install` sudah dijalankan dan .env berisi RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS.",
      }];
    }
  },

  "GET /api/stats": async () => {
    const chain = ledger.verifyChain();
    const entries = ledger.getEntriesBySeqs(
      Array.from({ length: chain.totalEntries }, (_, i) => i + 1)
    );
    const by = (key) =>
      entries.reduce((acc, e) => {
        const k = e[key] || "-";
        acc[k] = acc[k] || { jumlahEntri: 0, totalKg: 0 };
        acc[k].jumlahEntri++;
        acc[k].totalKg += e.kuantitasKg || 0;
        return acc;
      }, {});
    const anchored = entries.filter((e) => e.batchId !== null).length;
    return [200, {
      totalEntri: entries.length,
      integritasHashChain: chain.valid ? "UTUH" : "PUTUS",
      masalah: chain.problems,
      terAnchor: anchored,
      belumTerAnchor: entries.length - anchored,
      perAksi: by("aksi"),
      perKomoditas: by("komoditas"),
      perKoperasi: by("koperasiId"),
      // Sinyal demand sensing sederhana: agregat BUTUH per komoditas
      kebutuhan: entries
        .filter((e) => e.aksi === "BUTUH")
        .reduce((acc, e) => {
          acc[e.komoditas] = (acc[e.komoditas] || 0) + e.kuantitasKg;
          return acc;
        }, {}),
    }];
  },
};

// Route dengan parameter :seq
async function dynamicRoutes(method, pathname) {
  let m = pathname.match(/^\/api\/entries\/(\d+)$/);
  if (method === "GET" && m) {
    const entry = ledger.getEntry(parseInt(m[1], 10));
    return entry ? [200, entry] : [404, { error: `Entri #${m[1]} tidak ditemukan` }];
  }
  m = pathname.match(/^\/api\/verify\/(\d+)$/);
  if (method === "GET" && m) {
    const seq = parseInt(m[1], 10);
    const entry = ledger.getEntry(seq);
    if (!entry) return [404, { error: `Entri #${seq} tidak ditemukan` }];

    // Tingkat 1 selalu bisa
    const chain = ledger.verifyChain();
    const level1 = {
      valid: !chain.problems.some((p) => p.seq === seq),
      chainValid: chain.valid,
      problems: chain.problems,
    };
    // Tingkat 2 jika sudah di-anchor DAN dependensi tersedia
    const batch = ledger.getBatchForEntry(seq);
    if (!batch) return [200, { seq, level1, level2: { status: "belum di-anchor" } }];
    try {
      const { verifyEntry } = require("./verify");
      const r = await verifyEntry(seq);
      return [200, { seq, level1, level2: { valid: r.level2, batchId: r.batchId, txHash: r.txHash, proof: r.proof } }];
    } catch (err) {
      return [200, { seq, level1, level2: { status: "tidak tersedia: " + err.message } }];
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      const [status, body] = await routes[key](req, url);
      return send(res, status, body);
    }
    const dyn = await dynamicRoutes(req.method, url.pathname);
    if (dyn) return send(res, dyn[0], dyn[1]);
    return send(res, 404, { error: "Endpoint tidak ditemukan", lihat: "README.md" });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`SinergiDesa API berjalan di http://localhost:${PORT}`);
  console.log(`Coba: curl http://localhost:${PORT}/api/health`);
});

module.exports = server;
