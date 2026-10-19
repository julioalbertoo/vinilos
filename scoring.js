function norm(value) {
  return (value || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looselyEqual(a, b) {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

function isVinyl(candidate) {
  return candidate.formats.some((f) => /vinyl|^lp$|^\d+"$/i.test(f));
}

function formatHintMatches(candidate, hint) {
  const tokens = (hint || "")
    .toLowerCase()
    .split(/[^a-z0-9"]+/)
    .filter((t) => t.length >= 2 && !["vinyl", "vinilo", "disco"].includes(t));
  const formats = candidate.formats.map((f) => f.toLowerCase());
  return tokens.some((t) => formats.some((f) => f.includes(t)));
}

export function scoreCandidate(candidate, clues) {
  let score = 0;
  const matches = [];

  const barcode = (clues.barcode || "").replace(/\D/g, "");
  if (barcode && candidate.barcodes.some((b) => b.replace(/\D/g, "").includes(barcode))) {
    score += 5;
    matches.push("código de barras");
  }
  if (clues.catalog_number && norm(clues.catalog_number) === norm(candidate.catno)) {
    score += 4;
    matches.push("nº de catálogo");
  }
  if (looselyEqual(clues.label, candidate.label)) {
    score += 2;
    matches.push("sello");
  }
  if (looselyEqual(clues.country, candidate.country)) {
    score += 2;
    matches.push("país");
  }
  const clueYear = parseInt(clues.year_hint, 10);
  const candidateYear = parseInt(candidate.year, 10);
  if (clueYear && candidateYear) {
    if (clueYear === candidateYear) {
      score += 2;
      matches.push("año");
    } else if (Math.abs(clueYear - candidateYear) === 1) {
      score += 1;
      matches.push("año aproximado");
    }
  }
  if (isVinyl(candidate)) {
    score += 1;
    matches.push("vinilo");
  }
  if (formatHintMatches(candidate, clues.format_hint)) {
    score += 1;
    matches.push("formato");
  }
  return { ...candidate, score, matches };
}

// Empate: primero la edición que más gente tiene en su colección (la más probable).
export function rankCandidates(candidates, clues, limit = 5) {
  return candidates
    .map((c) => scoreCandidate(c, clues))
    .sort((a, b) => b.score - a.score || b.have - a.have)
    .slice(0, limit);
}
