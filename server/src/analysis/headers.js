import { domainToASCII } from 'node:url';
import { makeFinding, ruleParameters } from './utils.js';

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/giu;

function parseHeaderFields(raw) {
  const fields = new Map();
  let currentName = '';
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]+/.test(line) && currentName) {
      const values = fields.get(currentName);
      values[values.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([a-z0-9-]+):\s*(.*)$/i);
    if (!match) {
      currentName = '';
      continue;
    }
    currentName = match[1].toLowerCase();
    const values = fields.get(currentName) ?? [];
    values.push(match[2].trim());
    fields.set(currentName, values);
  }
  return fields;
}

function domainsFrom(value = '') {
  const domains = [];
  for (const match of value.matchAll(EMAIL_PATTERN)) {
    const at = match[0].lastIndexOf('@');
    const domain = domainToASCII(match[0].slice(at + 1).toLowerCase().replace(/\.$/, ''));
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

function relatedDomains(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function ruleMatchesAnyTerm(raw, terms = []) {
  const normalized = raw.toLowerCase();
  return terms.some((term) => typeof term === 'string' && normalized.includes(term.toLowerCase()));
}

export function evaluateHeaders(raw, rules) {
  const findings = [];
  const unknowns = [];
  if (!raw.trim()) {
    return {
      findings,
      unknowns: ['No original headers were provided, so sender-routing and authentication checks were unavailable.'],
      senderDomain: '',
      fields: new Map(),
    };
  }

  const fields = parseHeaderFields(raw);
  const fromValue = (fields.get('from') ?? []).join(', ');
  const replyValue = (fields.get('reply-to') ?? []).join(', ');
  const returnValue = (fields.get('return-path') ?? []).join(', ');
  const fromDomains = domainsFrom(fromValue);
  const replyDomains = domainsFrom(replyValue);
  const returnDomains = domainsFrom(returnValue);
  const senderDomain = fromDomains[0] ?? '';

  if (!fromDomains.length) unknowns.push('A sender domain could not be extracted from the supplied From header.');

  const replyRule = rules.get('header.sender-mismatch');
  if (replyRule && fromDomains.length && replyDomains.length
      && !fromDomains.some((from) => replyDomains.some((reply) => relatedDomains(from, reply)))) {
    findings.push(makeFinding(replyRule, 'header', `From domain: ${fromDomains.join(', ')}; Reply-To domain: ${replyDomains.join(', ')}`));
  } else if (!replyDomains.length) {
    unknowns.push('No usable Reply-To domain was available for comparison.');
  }

  const returnRule = rules.get('header.return-path-mismatch');
  if (returnRule && fromDomains.length && returnDomains.length
      && !fromDomains.some((from) => returnDomains.some((domain) => relatedDomains(from, domain)))) {
    findings.push(makeFinding(returnRule, 'header', `From domain: ${fromDomains.join(', ')}; Return-Path domain: ${returnDomains.join(', ')}`));
  } else if (!returnDomains.length) {
    unknowns.push('No usable Return-Path domain was available for comparison.');
  }

  const authLines = ['authentication-results', 'received-spf']
    .flatMap((name) => (fields.get(name) ?? []).map((value) => `${name}: ${value}`));
  if (!authLines.length) unknowns.push('No pasted SPF, DKIM, or DMARC result was available to review.');
  const authText = authLines.join('\n');
  const authFailureRule = rules.get('header.authentication-failure-claim');
  if (authFailureRule && ruleMatchesAnyTerm(authText, ruleParameters(authFailureRule).failureTerms)) {
    findings.push(makeFinding(authFailureRule, 'header', authLines[0].slice(0, 200)));
  }
  const authPassRule = rules.get('header.authentication-pass-claim');
  if (authPassRule && ruleMatchesAnyTerm(authText, ruleParameters(authPassRule).passTerms)) {
    findings.push(makeFinding(authPassRule, 'header', authLines[0].slice(0, 200)));
  }

  if (fields.has('received')) {
    unknowns.push('Received lines were supplied as text and their routing claims were not independently verified.');
  }
  unknowns.push('Pasted headers are user-supplied text; authentication and sender identity cannot be confirmed from the pasted text alone.');

  return { findings, unknowns: [...new Set(unknowns)], senderDomain, fields };
}

export function getDomainsFromHeaderValue(value) {
  return domainsFrom(value);
}
