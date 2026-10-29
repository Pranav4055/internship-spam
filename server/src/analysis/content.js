import { excerptForMatches, excerptAround, findGroups, findTerm, makeFinding, ruleParameters } from './utils.js';

function addGroupedFinding(findings, text, rules, ruleKey) {
  const rule = rules.get(ruleKey);
  if (!rule) return;
  const matches = findGroups(text, ruleParameters(rule).groups);
  if (matches) findings.push(makeFinding(rule, 'content', excerptForMatches(text, matches)));
}

function addTermFinding(findings, text, rules, ruleKey) {
  const rule = rules.get(ruleKey);
  if (!rule) return;
  const match = findTerm(text, ruleParameters(rule).terms);
  if (match) findings.push(makeFinding(rule, 'content', excerptForMatches(text, [match])));
}

function discussesInternshipOrPlacementOffer(text) {
  const normalized = text.toLocaleLowerCase();
  const recruitmentContext = /\b(?:offer(?:ed|ing)?|opportunit(?:y|ies)|opening|vacanc(?:y|ies)|role|position|recruit(?:ing|ment)?|hir(?:e|ing)|apply|application|interview|selection|selected|join us|stipend|paid)\b/;
  const placementContext = /\b(?:offer(?:ed|ing)?|opportunit(?:y|ies)|drive|opening|vacanc(?:y|ies)|role|position|recruit(?:ing|ment)?|hir(?:e|ing)|apply|application|interview|selection|selected|employer|job)\b/;

  // Require both an employment term and an offer or recruitment cue. Generic
  // references to students, registration, or a program are not enough.
  const internshipClaim = /\bintern(?:ship)?s?\b/.test(normalized) && recruitmentContext.test(normalized);
  const placementClaim = /\bplacements?\b/.test(normalized) && placementContext.test(normalized);
  return internshipClaim || placementClaim;
}

export function evaluateContent(text, rules, companyIdentity) {
  const findings = [];
  addGroupedFinding(findings, text, rules, 'content.upfront-payment');
  addGroupedFinding(findings, text, rules, 'content.sensitive-info-request');
  addGroupedFinding(findings, text, rules, 'content.personal-data-request');
  addTermFinding(findings, text, rules, 'content.urgent-pressure');
  addGroupedFinding(findings, text, rules, 'content.guaranteed-selection');
  addTermFinding(findings, text, rules, 'content.high-compensation-claim');

  const detailsRule = rules.get('content.missing-details');
  if (detailsRule && discussesInternshipOrPlacementOffer(text)) {
    const parameters = ruleParameters(detailsRule);
    const missing = [];
    if (!findTerm(text, parameters.roleTerms)) missing.push('the internship role or its responsibilities');
    if (!companyIdentity.companyName && !companyIdentity.officialDomain) missing.push('the employer identity');
    if (!findTerm(text, parameters.recruitmentTerms)) missing.push('application or selection steps');

    if (missing.length >= 2) {
      findings.push(makeFinding(detailsRule, 'content', excerptAround(text, 0, Math.min(text.length, 1)), {
        explanation: `The message leaves several important details unclear: ${missing.join('; ')}. A first-contact email may omit some of these details.`,
        recommendedAction: 'Ask for a written role description, the employer name, and a clear selection or application process.',
      }));
    }
  }

  return findings;
}
