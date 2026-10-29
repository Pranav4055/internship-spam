import { isIP } from 'node:net';
import { makeFinding, ruleParameters } from './utils.js';

const URL_PATTERN = /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s<>"'`]+|\b(?:javascript|data|file|ftp):[^\s<>"'`]+|\bwww\.[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:\/[^\s<>"'`]*)?/giu;
const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };

export function decodeHtmlEntities(value = '') {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt|nbsp));?/giu, (entity, decimal, hex, named) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
      if (codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return String.fromCodePoint(codePoint);
      }
      return entity;
    }
    return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
  });
}

function cleanCandidate(value) {
  return value.replace(/[.,;!?)}\]]+$/g, '');
}

export function parseStaticUrl(raw) {
  const defanged = /hxxps?:|\[\.\]|\(\.\)/i.test(raw);
  let value = raw.replace(/\[\.\]|\(\.\)/gi, '.').replace(/^hxxps:/i, 'https:').replace(/^hxxp:/i, 'http:');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!hasScheme) value = `https://${value}`;

  try {
    const parsed = new URL(value);
    return { raw, parsed, defanged };
  } catch {
    return { raw, parsed: null, defanged };
  }
}

export function extractUrls(text) {
  const results = [];
  const seen = new Set();
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    // A domain appearing as the host portion of an email address is not a link.
    if (text[index - 1] === '@') continue;
    const raw = cleanCandidate(match[0]);
    if (!raw) continue;
    const parsed = parseStaticUrl(raw);
    const key = parsed.parsed?.href ?? raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(parsed);
  }
  return results;
}

function safeHostEvidence(candidate) {
  if (!candidate.parsed) return 'A URL-like value could not be safely parsed.';
  const { parsed, defanged } = candidate;
  const protocol = parsed.protocol.toLowerCase();
  if (!parsed.hostname) return `${protocol} link (destination not opened)`;
  return `${defanged ? 'Defanged link normalized to ' : ''}${protocol}//${parsed.hostname}`;
}

function isRelatedDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
}

export function normalizeLinkText(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function looksLikeDisplayedUrl(value) {
  const text = decodeHtmlEntities(value).trim();
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z0-9-]+(?:[/:?#]|$))/i.test(text);
}

function looksLikeAbsoluteUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
    || /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z0-9-]+(?:[/:?#]|$)/i.test(value);
}

function normalizedHost(host) {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function mergeUrlCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    const key = candidate.parsed?.href ?? candidate.raw.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findingFor(rule, urls, condition, explanation) {
  const matches = urls.filter(condition);
  if (!matches.length || !rule) return null;
  const evidence = matches.slice(0, 3).map(safeHostEvidence).join('; ');
  return makeFinding(rule, 'url', evidence, explanation ? { explanation } : {});
}

export function evaluateUrls(text, rules, { senderDomain = '', companyDomain = '', links = [], linksTruncated = false } = {}) {
  const emailText = normalizeLinkText(text);
  const suppliedLinks = Array.isArray(links) ? links : [];
  const matchedLinks = suppliedLinks.filter((link) => link
    && typeof link.text === 'string'
    && typeof link.href === 'string'
    && normalizeLinkText(link.text)
    && emailText.includes(normalizeLinkText(link.text)));
  const destinationCandidates = matchedLinks.map((link) => {
    const href = decodeHtmlEntities(link.href.trim());
    return looksLikeAbsoluteUrl(href) ? parseStaticUrl(href) : null;
  });
  const urls = mergeUrlCandidates([
    ...extractUrls(text),
    ...destinationCandidates,
  ]);
  const findings = [];
  const paramsFor = (key) => ruleParameters(rules.get(key));
  const protocolRule = rules.get('url.unusual-scheme');
  const allowedSchemes = paramsFor('url.unusual-scheme').allowedSchemes ?? ['http:', 'https:'];
  const rulesToEvaluate = [
    findingFor(protocolRule, urls, ({ parsed }) => parsed && !allowedSchemes.includes(parsed.protocol.toLowerCase())),
    findingFor(rules.get('url.ip-address-host'), urls, ({ parsed }) => parsed && isIP(parsed.hostname) !== 0),
    findingFor(rules.get('url.embedded-credentials'), urls, ({ parsed }) => parsed && (parsed.username || parsed.password)),
    findingFor(rules.get('url.punycode-host'), urls, ({ parsed }) => parsed && parsed.hostname.toLowerCase().split('.').some((label) => label.startsWith('xn--'))),
    findingFor(rules.get('url.shortener'), urls, ({ parsed }) => parsed && (paramsFor('url.shortener').hosts ?? []).includes(parsed.hostname.toLowerCase())),
    findingFor(rules.get('url.suspicious-host'), urls, ({ parsed }) => parsed
      && parsed.hostname.split('.').length >= (paramsFor('url.suspicious-host').labelCountThreshold ?? 5)),
    findingFor(rules.get('url.misleading-company-domain'), urls, ({ parsed }) => {
      const host = parsed?.hostname.toLowerCase();
      const domains = [senderDomain, companyDomain].filter(Boolean).map((domain) => domain.toLowerCase());
      return Boolean(host && domains.some((domain) => host.includes(domain) && !isRelatedDomain(host, domain)));
    }),
  ];

  findings.push(...rulesToEvaluate.filter(Boolean));

  const mismatches = matchedLinks.flatMap((link) => {
    const visibleText = decodeHtmlEntities(link.text).trim();
    const destinationText = decodeHtmlEntities(link.href.trim());
    if (!looksLikeDisplayedUrl(visibleText)) return [];
    // Relative hrefs depend on a page base URL. Since we never visit the
    // message or invent a base, they cannot be compared as destinations.
    if (!looksLikeAbsoluteUrl(destinationText)) return [];
    const displayed = parseStaticUrl(visibleText);
    const destination = parseStaticUrl(destinationText);
    const displayedHost = displayed.parsed?.hostname ?? '';
    const destinationHost = destination.parsed?.hostname ?? '';
    if (!displayedHost || !destinationHost
        || normalizedHost(displayedHost) === normalizedHost(destinationHost)) return [];
    return [{ displayedHost, destinationHost }];
  });
  const mismatchRule = rules.get('url.display-destination-mismatch');
  if (mismatchRule && mismatches.length) {
    const evidence = [...new Map(mismatches.map((item) => [
      `${item.displayedHost}:${item.destinationHost}`,
      `Displayed URL host: ${item.displayedHost}; hyperlink destination host: ${item.destinationHost}`,
    ])).values()].slice(0, 3).join('; ');
    findings.push(makeFinding(mismatchRule, 'url', evidence));
  }

  return {
    urls,
    findings,
    linkMetadataProvided: suppliedLinks.length > 0,
    analyzedLinkCount: matchedLinks.length,
    unmatchedLinkCount: suppliedLinks.length - matchedLinks.length,
    unparseableLinkCount: destinationCandidates.filter((candidate) => !candidate?.parsed).length,
    linksTruncated,
  };
}

export function getSafeUrlEvidence(candidate) {
  return safeHostEvidence(candidate);
}
