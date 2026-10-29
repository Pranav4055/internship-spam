export function ruleParameters(rule) {
  return rule?.parameters && typeof rule.parameters === 'object' && !Array.isArray(rule.parameters)
    ? rule.parameters
    : {};
}

function isNegated(text, index) {
  const prefix = text.slice(Math.max(0, index - 55), index);
  return /\b(?:never|don't|dont|do not|does not|not|avoid|without|no need to|not required to)\b[^.!?;]{0,45}$/i.test(prefix);
}

export function findTerm(text, terms = []) {
  for (const term of terms) {
    if (typeof term !== 'string' || !term.trim()) continue;
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`\\b${escaped}s?\\b`, 'gi');
    let match;
    while ((match = expression.exec(text))) {
      if (!isNegated(text, match.index)) {
        return { term: match[0], index: match.index, end: match.index + match[0].length };
      }
    }
  }
  return null;
}

export function findGroups(text, groups = []) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const matches = groups.map((group) => findTerm(text, Array.isArray(group) ? group : []));
  return matches.every(Boolean) ? matches : null;
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const URL_LIKE_PATTERN = /\b[a-z][a-z0-9+.-]{0,20}:(?:\/\/)?[^\s<>"'`]+|\bwww\.[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#][^\s<>"'`]*)?/giu;

function redactUrl(raw) {
  const trimmed = raw.replace(/[.,;!?)}\]]+$/g, '');
  const defanged = trimmed.replace(/\[\.\]|\(\.\)/gi, '.').replace(/^hxxps:/i, 'https:').replace(/^hxxp:/i, 'http:');
  const value = /^[a-z][a-z0-9+.-]*:/i.test(defanged) ? defanged : `https://${defanged}`;
  try {
    const parsed = new URL(value);
    return parsed.hostname
      ? `${parsed.protocol}//${parsed.hostname}${raw.slice(trimmed.length)}`
      : `[${parsed.protocol.slice(0, -1)} link details omitted]${raw.slice(trimmed.length)}`;
  } catch {
    return '[link details omitted]';
  }
}

function redactPersonalValues(value) {
  return value
    .replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email address omitted]')
    .replace(/\+?\d[\d().\s-]{7,}\d/g, (number) => (number.match(/\d/g)?.length >= 9 ? '[number omitted]' : number))
    .replace(/\b(?:name|phone|mobile|address|aadhaar|aadhar|passport|account|routing|ssn|national id)(?:\s+(?:number|no\.?))?\s*[:=]\s*[^,;.!?\n]+/gi, (field) => `${field.split(/[:=]/, 1)[0]}: [details omitted]`);
}

function sanitizeEvidence(value) {
  const urlsRedacted = value.replace(URL_LIKE_PATTERN, (raw, index, original) => (
    original[index - 1] === '@' ? raw : redactUrl(raw)
  ));
  return redactPersonalValues(urlsRedacted);
}

function isWordCharacterAt(text, index) {
  return index >= 0 && index < text.length && WORD_CHARACTER.test(text[index]);
}

function startOfWord(text, index) {
  let boundary = index;
  while (boundary > 0 && isWordCharacterAt(text, boundary) && isWordCharacterAt(text, boundary - 1)) boundary -= 1;
  return boundary;
}

function endOfWord(text, index) {
  let boundary = index;
  while (boundary < text.length && isWordCharacterAt(text, boundary) && isWordCharacterAt(text, boundary - 1)) boundary += 1;
  return boundary;
}

function formatExcerptRange(text, start, end) {
  let lowerBound = Math.max(0, start);
  let upperBound = Math.min(text.length, end);
  if (lowerBound > 0 && isWordCharacterAt(text, lowerBound) && isWordCharacterAt(text, lowerBound - 1)) {
    lowerBound = startOfWord(text, lowerBound);
  }
  if (upperBound < text.length && isWordCharacterAt(text, upperBound) && isWordCharacterAt(text, upperBound - 1)) {
    upperBound = endOfWord(text, upperBound);
  }
  while (lowerBound < upperBound && /\s/.test(text[lowerBound])) lowerBound += 1;
  while (upperBound > lowerBound && /\s/.test(text[upperBound - 1])) upperBound -= 1;

  let excerpt = sanitizeEvidence(text.slice(lowerBound, upperBound).replace(/\s+/g, ' ').trim());
  if (lowerBound > 0) excerpt = `…${excerpt}`;
  if (upperBound < text.length) excerpt = `${excerpt}…`;
  return `“${excerpt}”`;
}

export function excerptAround(text, start = 0, end = start + 1, maxLength = 220) {
  if (!text) return '';
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const context = Math.max(0, maxLength - (safeEnd - safeStart));
  const before = Math.min(safeStart, Math.floor(context / 2));
  const after = Math.min(text.length - safeEnd, context - before);
  return formatExcerptRange(text, safeStart - before, safeEnd + after);
}

export function excerptForMatches(text, matches) {
  if (!matches?.length) return excerptAround(text, 0, Math.min(text.length, 1));
  const distinctMatches = [...new Map(matches.map((match) => [`${match.index}:${match.end}`, match])).values()]
    .sort((left, right) => left.index - right.index);
  const ranges = distinctMatches.map((match) => ({
    start: Math.max(0, match.index - 32),
    end: Math.min(text.length, match.end + 40),
  }));
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 20) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const excerpts = merged.map((range) => formatExcerptRange(text, range.start, range.end));
  return [...new Set(excerpts)].join(' … ');
}

export function makeFinding(rule, category, evidence, overrides = {}) {
  const parameters = ruleParameters(rule);
  return {
    ruleKey: rule.ruleKey,
    category,
    title: overrides.title ?? parameters.title ?? rule.description,
    severity: overrides.severity ?? rule.severity,
    explanation: overrides.explanation ?? parameters.explanation ?? rule.description,
    evidence,
    recommendedAction: overrides.recommendedAction ?? parameters.recommendedAction ?? 'Verify this detail independently before proceeding.',
  };
}

export function containsAny(text, terms = []) {
  return Boolean(findTerm(text, terms));
}
