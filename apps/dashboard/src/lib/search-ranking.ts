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
  "cz",
  "film",
  "for",
  "in",
  "of",
  "online",
  "or",
  "serial",
  "the",
  "to",
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
    fieldTokens.some((fieldToken) => tokenFuzzyScore(queryToken, fieldToken) >= 46),
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

  const queryTokens = requiredCoverageTokens(query);
  if (queryTokens.length === 0) {
    return false;
  }

  const fieldTokens = fields.flatMap(requiredCoverageTokens);
  return queryTokens.every((queryToken) =>
    fieldTokens.some((fieldToken) => tokenFuzzyScore(queryToken, fieldToken) >= 46),
  );
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
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
  if (queryToken.startsWith(candidateToken) && candidateToken.length >= 4) return 72;
  if (minTokenLength >= 3 && candidateToken.includes(queryToken)) return 54;

  const distance = levenshteinDistance(queryToken, candidateToken);
  const limit = queryToken.length >= 8 || candidateToken.length >= 8 ? 2 : 1;
  if (distance > limit) return 0;

  if (distance === 1) return 46;
  if (distance === 2) return 28;
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
    for (const queryToken of queryTokens) {
      let bestTokenScore = 0;
      for (const fieldToken of fieldTokens) {
        bestTokenScore = Math.max(bestTokenScore, tokenFuzzyScore(queryToken, fieldToken));
      }
      if (bestTokenScore >= 46) {
        matchedTokens += 1;
      }
      score += bestTokenScore;
    }

    if (queryTokens.length > 0) {
      score += Math.round((matchedTokens / queryTokens.length) * 180);
      if (matchedTokens === queryTokens.length) {
        score += 120;
      }
    }

    if (fieldTokens.length > 0 && queryTokens.length > 0) {
      const firstQueryToken = queryTokens[0];
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
