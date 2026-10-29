import { parseStaticUrl } from './urls.js';
import { makeFinding } from './utils.js';

const COMPANY_FIELD = /\b(?:company(?:\s+name)?|employer|organization)\s*[:\-]\s*([^\r\n.!?;,]{2,80})/i;
const OFFICIAL_SITE_FIELD = /\b(?:(?:official\s+(?:company\s+)?(?:website|site|domain))|(?:company\s+(?:website|site|domain))|(?:careers\s+(?:website|site|page)))\s*(?:is\s+|:\s*|[-–]\s*)?((?:https?:\/\/|www\.)[^\s<>"'`]+|(?:[a-z0-9-]+\.)+[a-z]{2,})/i;
const COMMON_COMPANY_WORDS = new Set(['the', 'and', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'group', 'careers', 'technology', 'technologies', 'solutions', 'services']);

function cleanClaim(value) {
  const cleaned = value?.trim().replace(/\s+(?:is|is hiring|is recruiting)$/i, '').trim() ?? '';
  if (/^(?:we|our|the|a|an|confidential|unnamed|undisclosed)\b/i.test(cleaned)) return '';
  return cleaned;
}

export function extractCompanyIdentity(text) {
  const nameMatch = text.match(COMPANY_FIELD);
  const officialMatch = text.match(OFFICIAL_SITE_FIELD);
  const officialUrl = officialMatch?.[1]?.replace(/[.,;!?)}\]]+$/g, '') ?? '';
  const parsedSite = officialUrl ? parseStaticUrl(officialUrl) : null;
  return {
    companyName: cleanClaim(nameMatch?.[1]),
    officialDomain: parsedSite?.parsed?.hostname?.toLowerCase() ?? '',
    officialDomainEvidence: officialUrl,
  };
}

function relatedDomains(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function companyTokens(name) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !COMMON_COMPANY_WORDS.has(token));
}

function nameAppearsInDomain(name, domain) {
  const foldedDomain = domain.replace(/[^a-z0-9]/g, '');
  return companyTokens(name).some((token) => foldedDomain.includes(token));
}

export function evaluateCompany(text, senderDomain, rules) {
  const identity = extractCompanyIdentity(text);
  const findings = [];
  const unknowns = [];
  const evidence = `Company claim: ${identity.companyName || 'not confidently identified'}; sender domain: ${senderDomain || 'not available'}`;

  if (!identity.companyName && !identity.officialDomain) {
    unknowns.push('The company identity could not be confidently extracted from the message.');
    return { identity, findings, unknowns };
  }
  if (!senderDomain) {
    unknowns.push('A sender domain was not available to compare with the company details in the message.');
    unknowns.push('A named company or domain has not been independently verified as genuine.');
    return { identity, findings, unknowns };
  }

  if (identity.companyName && !nameAppearsInDomain(identity.companyName, senderDomain)) {
    const rule = rules.get('company.identity-consistency');
    if (rule) findings.push(makeFinding(rule, 'company', evidence));
  }

  if (identity.officialDomain && !relatedDomains(identity.officialDomain, senderDomain)) {
    const rule = rules.get('company.official-domain-mismatch');
    if (rule) {
      findings.push(makeFinding(rule, 'company', `Labeled official domain: ${identity.officialDomain}; sender domain: ${senderDomain}`));
    }
  }

  unknowns.push('A company name or domain match is only a consistency signal; company legitimacy was not independently verified.');
  return { identity, findings, unknowns };
}
