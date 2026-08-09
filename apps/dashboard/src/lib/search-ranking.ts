export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/online-(film|serial)-/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips leading/trailing filler words ("the", "show", "movie") from a query so
// providers receive a searchable core instead of raw phrasing. Prepositions in
// the middle of titles are preserved ("game of thrones" stays intact).
export function trimWeakSearchEdges(value: string) {
  const tokens = tokenize(value);
  const significant = (token: string) => !WEAK_SEARCH_TOKENS.has(token);
  let start = 0;
  while (start < tokens.length && !significant(tokens[start])) start += 1;
  let end = tokens.length;
  while (end > start && !significant(tokens[end - 1])) end -= 1;
  const trimmed = tokens.slice(start, end);
  if (trimmed.length === 0 || trimmed.length === tokens.length) {
    return value.trim();
  }
  return trimmed.join(" ");
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function tokenize(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

const WEAK_SEARCH_TOKENS = new Set([
  "a",
  "an",
  "and",
  "czech",
  "cz",
  "download",
  "dubbed",
  "english",
  "episode",
  "episodes",
  "film",
  "for",
  "free",
  "full",
  "hd",
  "in",
  "movie",
  "movies",
  "of",
  "online",
  "or",
  "season",
  "seasons",
  "serial",
  "series",
  "show",
  "shows",
  "stream",
  "the",
  "to",
  "tv",
  "watch",
  "watching",
]);

function significantTokens(value: string) {
  return tokenize(value).filter((token) => {
    if (WEAK_SEARCH_TOKENS.has(token)) {
      return false;
    }
    if (/^\d+$/.test(token) && token.length < 4) {
      return false;
    }
    return token.length >= 3;
  });
}

function requiredCoverageTokens(value: string) {
  return tokenize(value).filter((token) => !WEAK_SEARCH_TOKENS.has(token) && token.length >= 2);
}

// Tolerant token matcher used by the coverage gates. Unlike `tokenFuzzyScore`
// (which ranks), this is a boolean "close enough" test so small wording
// changes - a typo, a missing letter, a glued or split word - still hit.
function queryTokenCovered(queryToken: string, candidateToken: string) {
  if (!queryToken || !candidateToken) return false;
  if (queryToken === candidateToken) return true;
  if (candidateToken.startsWith(queryToken)) return true;
  if (queryToken.startsWith(candidateToken) && candidateToken.length >= 4) return true;
  // Glued-word containment ("ultron" inside "ageofultron"), but only for longer
  // query tokens so a 4-letter query like "silo" is not swallowed by "zbesilost".
  if (queryToken.length >= 5 && candidateToken.includes(queryToken)) return true;

  const limit = queryToken.length >= 6 || candidateToken.length >= 6 ? 2 : 1;
  const distance = levenshteinDistance(queryToken, candidateToken, limit);
  return distance <= limit;
}

export function hasSignificantSearchTokenMatch(query: string, rawFields: Array<string | null | undefined>) {
  const normalizedQuery = normalizeSearchText(query);
  const fields = rawFields.map((value) => String(value || "")).filter(Boolean);
  if (!normalizedQuery || fields.length === 0) {
    return false;
  }

  if (fields.some((field) => normalizeSearchText(field) === normalizedQuery)) {
    return true;
  }

  const queryTokens = significantTokens(query);
  if (queryTokens.length === 0) {
    return false;
  }

  const fieldTokens = fields.flatMap(significantTokens);
  return queryTokens.some((queryToken) =>
    fieldTokens.some((fieldToken) => queryTokenCovered(queryToken, fieldToken)),
  );
}

export function hasRequiredSearchTokenCoverage(query: string, rawFields: Array<string | null | undefined>) {
  const normalizedQuery = normalizeSearchText(query);
  const fields = rawFields.map((value) => String(value || "")).filter(Boolean);
  if (!normalizedQuery || fields.length === 0) {
    return false;
  }

  if (fields.some((field) => normalizeSearchText(field) === normalizedQuery)) {
    return true;
  }

  // Compact equality catches split words ("spider man" vs "spiderman").
  const compactQuery = compactSearchText(query);
  if (compactQuery.length >= 4 && fields.some((field) => compactSearchText(field) === compactQuery)) {
    return true;
  }

  const queryTokens = requiredCoverageTokens(query);
  if (queryTokens.length === 0) {
    return false;
  }

  const fieldTokens = fields.flatMap(requiredCoverageTokens);
  let covered = 0;
  for (const queryToken of queryTokens) {
    if (fieldTokens.some((fieldToken) => queryTokenCovered(queryToken, fieldToken))) {
      covered += 1;
    }
  }

  if (covered === queryTokens.length) {
    return true;
  }
  // Tolerate one misspelled or extra word in longer queries so "game of thronz"
  // or "avengers endgame trailer" still find the real title.
  return queryTokens.length >= 3 && covered >= queryTokens.length - 1;
}

const EDIT_DISTANCE_CACHE_MAX = 4_000;
const editDistanceCache = new Map<string, number>();

// Bounded edit distance avoids filling the whole matrix for token pairs that
// cannot possibly pass our typo threshold. The tiny cache is shared by the
// browser and node bundles and helps repeated ranking/coverage passes.
function levenshteinDistance(a: string, b: string, maximum = Number.POSITIVE_INFINITY) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
  const cacheKey = `${maximum}:${a}:${b}`;
  const cached = editDistanceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }

    if (rowMinimum > maximum) return maximum + 1;

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }
  const result = previous[b.length];
  if (editDistanceCache.size >= EDIT_DISTANCE_CACHE_MAX) editDistanceCache.clear();
  editDistanceCache.set(cacheKey, result);
  return result;
}

function tokenFuzzyScore(queryToken: string, candidateToken: string) {
  if (!queryToken || !candidateToken) return 0;
  const queryIsNumeric = /^\d+$/.test(queryToken);
  const candidateIsNumeric = /^\d+$/.test(candidateToken);
  if ((queryIsNumeric || candidateIsNumeric) && queryToken !== candidateToken) {
    return 0;
  }

  const minTokenLength = Math.min(queryToken.length, candidateToken.length);
  if (queryToken === candidateToken) return 120;
  if (candidateToken.startsWith(queryToken)) return 92;
  if (queryToken.startsWith(candidateToken) && candidateToken.length >= 4) {
    return queryToken.length - candidateToken.length <= 2 ? 72 : 20;
  }
  if (minTokenLength >= 3 && candidateToken.includes(queryToken)) return 54;

  const limit = queryToken.length >= 6 || candidateToken.length >= 6 ? 2 : 1;
  const distance = levenshteinDistance(queryToken, candidateToken, limit);
  if (distance > limit) return 0;

  if (distance === 1) return 46;
  if (distance === 2) return 46;
  return 0;
}

export function scoreSearchCandidate(query: string, rawFields: Array<string | null | undefined>, index = 0) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const compactQuery = compactSearchText(query);
  const compactQueryIsShortNumeric = /^\d+$/.test(compactQuery) && compactQuery.length < 4;
  const queryTokens = tokenize(query);
  // Weak filler words ("the", "movie", "show") should not dilute how many
  // meaningful tokens matched, so rank only on the significant subset.
  const scoringTokens = queryTokens.filter((token) => !WEAK_SEARCH_TOKENS.has(token));
  const effectiveQueryTokens = scoringTokens.length > 0 ? scoringTokens : queryTokens;
  const fields = rawFields
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (fields.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const field of fields) {
    const normalizedField = normalizeSearchText(field);
    if (!normalizedField) {
      continue;
    }

    const compactField = compactSearchText(field);
    const fieldTokens = tokenize(field);
    let score = 0;

    if (normalizedField === normalizedQuery) score += 1200;
    if (compactField === compactQuery && compactQuery.length >= 4) score += 1080;
    if (!compactQueryIsShortNumeric && normalizedField.startsWith(normalizedQuery)) score += 760;
    if (!compactQueryIsShortNumeric && compactField.startsWith(compactQuery) && compactQuery.length >= 4) score += 680;
    if (!compactQueryIsShortNumeric && normalizedField.includes(normalizedQuery)) score += 520;
    if (!compactQueryIsShortNumeric && compactField.includes(compactQuery) && compactQuery.length >= 4) score += 420;

    let matchedTokens = 0;
    for (const queryToken of effectiveQueryTokens) {
      let bestTokenScore = 0;
      for (const fieldToken of fieldTokens) {
        bestTokenScore = Math.max(bestTokenScore, tokenFuzzyScore(queryToken, fieldToken));
      }
      if (bestTokenScore >= 46) {
        matchedTokens += 1;
      }
      score += bestTokenScore;
    }

    if (effectiveQueryTokens.length > 0) {
      score += Math.round((matchedTokens / effectiveQueryTokens.length) * 180);
      if (matchedTokens === effectiveQueryTokens.length) {
        score += 120;
      }
    }

    if (fieldTokens.length > 0 && effectiveQueryTokens.length > 0) {
      const firstQueryToken = effectiveQueryTokens[0];
      const firstFieldToken = fieldTokens[0];
      if (firstFieldToken === firstQueryToken) score += 70;
      else if (tokenFuzzyScore(firstQueryToken, firstFieldToken) >= 46) score += 35;
    }

    bestScore = Math.max(bestScore, score);
  }

  if (bestScore <= 0) {
    return 0;
  }

  return bestScore + Math.max(0, 40 - index);
}

export function compareSearchScores<T extends { matchScore?: number }>(left: T, right: T) {
  const scoreDiff = (right.matchScore ?? 0) - (left.matchScore ?? 0);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const leftTitle = normalizeSearchText(String((left as { title?: string }).title || ""));
  const rightTitle = normalizeSearchText(String((right as { title?: string }).title || ""));
  return leftTitle.localeCompare(rightTitle);
}

export function keepHighConfidenceSearchResults<T extends { matchScore?: number }>(results: T[]) {
  const sorted = [...results].sort(compareSearchScores);
  const topScore = sorted[0]?.matchScore ?? 0;
  if (topScore < 5000) {
    return sorted;
  }

  const threshold = Math.max(1800, Math.round(topScore * 0.45));
  return sorted.filter((result) => (result.matchScore ?? 0) >= threshold);
}

type UnifiedSearchRankingItem = {
  title: string;
  alternateTitles?: string[];
  mediaType?: "movie" | "serial";
  year?: string | null;
  matchScore?: number;
  searchSignals?: {
    popularity?: number | null;
    voteCount?: number | null;
    voteAverage?: number | null;
    releaseDate?: string | null;
    originalLanguage?: string | null;
  };
};

const SEARCH_NOISE_PATTERN = /\b(?:bts|behind the scenes|making of|featurette|interview|conversation|im gesprach|gesprach|fan film|parody|trailer)\b/i;

function parseSearchYear(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parseRequestedSearchYear(value: string) {
  const tokens = tokenize(value);
  // A lone four-digit value may be the literal title (1899, 1923). Treat it
  // as a year only when another title token supplies context ("Dune 1984").
  return tokens.length > 1 ? parseSearchYear(value) : null;
}

export type SearchScoreBreakdown = {
  text: number;
  identity: number;
  popularity: number;
  year: number;
  noise: number;
  provider: number;
  total: number;
};

export function explainUnifiedSearchResultScore(query: string, item: UnifiedSearchRankingItem, index = 0): SearchScoreBreakdown {
  const rankingQuery = trimWeakSearchEdges(query);
  const normalizedQuery = normalizeSearchText(rankingQuery);
  const normalizedTitle = normalizeSearchText(item.title);
  const normalizedAliases = (item.alternateTitles ?? []).map(normalizeSearchText).filter(Boolean);
  const displayExact = normalizedTitle === normalizedQuery;
  const aliasExact = normalizedAliases.includes(normalizedQuery);
  const canonicalExact = displayExact || aliasExact;
  const displayPrefix = normalizedTitle.startsWith(`${normalizedQuery} `) || normalizedTitle.startsWith(`${normalizedQuery}:`);
  const aliasPrefix = normalizedAliases.some((alias) => alias.startsWith(`${normalizedQuery} `) || alias.startsWith(`${normalizedQuery}:`));
  const text = scoreSearchCandidate(rankingQuery, [item.title, ...(item.alternateTitles ?? []), item.year], index);
  const identity = displayExact ? 50_000 : aliasExact ? 48_000 : displayPrefix ? 24_000 : aliasPrefix ? 22_000 :
    hasRequiredSearchTokenCoverage(query, [item.title, ...(item.alternateTitles ?? []), item.year]) ? 12_000 : 0;
  const noise = !canonicalExact && !SEARCH_NOISE_PATTERN.test(normalizedQuery) && SEARCH_NOISE_PATTERN.test(normalizedTitle) ? -18_000 : 0;

  const signals = item.searchSignals;
  const popularityValue = Math.max(0, signals?.popularity ?? 0);
  const voteCount = Math.max(0, signals?.voteCount ?? 0);
  let popularity = Math.min(4_000, Math.round(popularityValue * 12)) + Math.min(4_000, Math.round(Math.log10(voteCount + 1) * 1_200));
  const candidateYear = parseSearchYear(signals?.releaseDate ?? item.year);
  const requestedYear = parseRequestedSearchYear(query);
  const currentYear = new Date().getFullYear();
  let year = 0;
  if (requestedYear !== null && candidateYear !== null) {
    year += requestedYear === candidateYear ? 20_000 : -Math.min(20_000, Math.abs(requestedYear - candidateYear) * 2_500);
  } else if (canonicalExact && candidateYear !== null) {
    year += Math.max(0, Math.min(currentYear + 2, candidateYear) - 1900) * 10;
  }
  if (canonicalExact && item.mediaType === "movie" && (voteCount >= 100 || popularityValue >= 20)) popularity += 3_500;
  if (requestedYear === null && canonicalExact && item.mediaType === "movie" && candidateYear !== null && candidateYear >= currentYear - 1 && candidateYear <= currentYear + 2) year += 6_000;
  const provider = Math.min(1_000, Math.max(0, Math.round((item.matchScore ?? 0) / 8)));
  const total = text + identity + popularity + year + noise + provider;
  return { text, identity, popularity, year, noise, provider, total };
}

export function unifiedSearchResultScore(query: string, item: UnifiedSearchRankingItem, index = 0) {
  return explainUnifiedSearchResultScore(query, item, index).total;
}

export function sortUnifiedSearchResults<T extends UnifiedSearchRankingItem>(query: string, results: T[]) {
  return [...results].sort((left, right) => {
    const scoreDelta = unifiedSearchResultScore(query, right) - unifiedSearchResultScore(query, left);
    if (scoreDelta !== 0) return scoreDelta;
    return compareSearchScores(left, right);
  });
}
