// parser.js — Pilar 1: Antarmuka Tanpa Aplikasi (Text Parsing Engine)
// Sesuai Slide 4 deck v2: rule-based + fuzzy matching (Levenshtein),
// dengan alur konfirmasi otomatis YA/TIDAK untuk pesan ambigu.
//
// Format pesan yang didukung:
//   KIRIM#KOMODITAS#KUANTITAS#ARMADA     -> laporan pengiriman
//   JUAL#KOMODITAS#KUANTITAS#HARGA       -> penawaran jual
//   TERIMA#KOMODITAS#KUANTITAS#OK        -> konfirmasi penerimaan (dual-witness)
//   BUTUH#KOMODITAS#KUANTITAS            -> laporan kebutuhan (demand sensing)

const AKSI = ["KIRIM", "JUAL", "TERIMA", "BUTUH"];

// Kamus komoditas — di produksi diisi dari profil komoditas desa (Slide 5 Tahap 1)
const KOMODITAS = ["BELERANG", "GABAH", "PUPUK", "JAGUNG", "KOPI", "BERAS", "CABAI"];

// Ambang fuzzy: jarak Levenshtein maksimum agar sebuah kata dianggap cocok.
// <= AUTO  : langsung diterima (typo ringan spt KRIM, BELERNG)
// <= CONFIRM: diterima sebagai tebakan, minta konfirmasi YA/TIDAK
const FUZZY_AUTO = 2;
const FUZZY_CONFIRM = 3;

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

/** Cocokkan kata ke kamus. Hasil: {match, distance} terbaik. */
function fuzzyMatch(word, dictionary) {
  let best = null;
  for (const cand of dictionary) {
    const d = levenshtein(word, cand);
    if (!best || d < best.distance) best = { match: cand, distance: d };
  }
  return best;
}

/** Normalisasi kuantitas: "5TON", "5 TON", "500KG" -> kg (integer). */
function parseKuantitas(raw) {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  const m = s.match(/^([\d.,]+)(TON|KG|KWINTAL|KW)$/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(",", "."));
  if (isNaN(num) || num <= 0) return null;
  const factor = { TON: 1000, KG: 1, KWINTAL: 100, KW: 100 }[m[2]];
  return Math.round(num * factor);
}

/** Normalisasi harga: "RP12000", "RP 12.000" -> integer rupiah. */
function parseHarga(raw) {
  const s = raw.replace(/[\s.]/g, "").toUpperCase();
  const m = s.match(/^RP(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Parse satu pesan teks.
 * @param {string} text     isi pesan
 * @param {string} nomorHp  nomor pengirim (harus terdaftar — KYC ringan, Slide 10)
 * @param {object} anggota  peta nomorHp -> {nama, koperasiId}
 * @returns {ok, entry?, needsConfirmation?, reply}
 *   ok=true  + entry              -> langsung dicatat ke ledger
 *   ok=false + needsConfirmation  -> sistem membalas tebakan + minta YA/TIDAK
 *   ok=false                      -> ditolak (format/identitas), reply menjelaskan
 */
function parseMessage(text, nomorHp, anggota) {
  // 1. Autentikasi: hanya nomor terdaftar (registrasi oleh pengurus koperasi)
  const profil = anggota[nomorHp];
  if (!profil) {
    return {
      ok: false,
      reply: "Nomor Anda belum terdaftar. Silakan hubungi pengurus koperasi untuk registrasi.",
    };
  }

  const parts = text.trim().toUpperCase().split("#").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) {
    return {
      ok: false,
      reply: "Format tidak dikenali. Contoh: JUAL#GABAH#2TON#RP12000",
    };
  }

  // 2. Fuzzy match aksi & komoditas
  const aksiRes = fuzzyMatch(parts[0], AKSI);
  const komRes = fuzzyMatch(parts[1], KOMODITAS);
  const worst = Math.max(aksiRes.distance, komRes.distance);

  if (worst > FUZZY_CONFIRM) {
    return {
      ok: false,
      reply: `Pesan tidak dikenali. Kata kunci yang tersedia: ${AKSI.join("/")}. Contoh: BUTUH#PUPUK#500KG`,
    };
  }

  // 3. Kuantitas wajib
  const kuantitasKg = parseKuantitas(parts[2]);
  if (kuantitasKg === null) {
    return {
      ok: false,
      reply: `Kuantitas "${parts[2]}" tidak dikenali. Gunakan TON/KG, contoh: 5TON atau 500KG.`,
    };
  }

  // 4. Field ke-4 tergantung aksi
  const entry = {
    aksi: aksiRes.match,
    komoditas: komRes.match,
    kuantitasKg,
    pengirim: nomorHp,
    nama: profil.nama,
    koperasiId: profil.koperasiId,
  };
  if (aksiRes.match === "JUAL") {
    const harga = parts[3] ? parseHarga(parts[3]) : null;
    if (harga === null) {
      return { ok: false, reply: "Harga tidak dikenali. Contoh: JUAL#GABAH#2TON#RP12000" };
    }
    entry.hargaRp = harga;
  } else if (aksiRes.match === "KIRIM") {
    if (!parts[3]) return { ok: false, reply: "Armada wajib diisi. Contoh: KIRIM#BELERANG#5TON#TRUK123" };
    entry.armada = parts[3];
  } else if (aksiRes.match === "TERIMA") {
    entry.status = parts[3] === "OK" ? "OK" : parts[3] || "OK";
  }
  // BUTUH: 3 field saja, tidak perlu tambahan

  // 5. Typo berat tapi masih tertebak -> alur konfirmasi (gratis di jendela 24 jam WA)
  if (worst > FUZZY_AUTO) {
    const tebakan = [entry.aksi, entry.komoditas, parts[2], parts[3]].filter(Boolean).join("#");
    return {
      ok: false,
      needsConfirmation: true,
      entry, // disimpan sementara oleh gateway; dicatat setelah balasan "YA"
      reply: `Apakah maksud Anda: ${tebakan}? Balas YA atau TIDAK.`,
    };
  }

  return {
    ok: true,
    entry,
    reply:
      `Tercatat: ${entry.aksi} ${entry.komoditas} ${kuantitasKg} kg` +
      (entry.hargaRp ? ` @ Rp${entry.hargaRp}` : "") +
      (entry.armada ? ` (${entry.armada})` : "") +
      `. Terima kasih, ${profil.nama}.`,
  };
}

module.exports = { parseMessage, levenshtein, fuzzyMatch, parseKuantitas, parseHarga, AKSI, KOMODITAS };
