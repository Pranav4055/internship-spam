import { evaluateCompany, extractCompanyIdentity } from './company.js';
import { classifyFindings, classificationExplanation, summarizeRisk } from './classify.js';
import { evaluateContent } from './content.js';
import { evaluateHeaders } from './headers.js';
import { RuleDataUnavailableError } from './ruleDataError.js';
import { loadDetectionRules } from './ruleRepository.js';
import { evaluateUrls } from './urls.js';

const SUPPORTED_RULE_KEYS = new Set([
  'content.upfront-payment',
  'content.sensitive-info-request',
  'content.personal-data-request',
  'content.urgent-pressure',
  'content.guaranteed-selection',
  'content.high-compensation-claim',
  'content.missing-details',
  'header.sender-mismatch',
  'header.authentication-failure-claim',
  'header.authentication-pass-claim',
  'header.return-path-mismatch',
  'url.unusual-scheme',
  'url.display-destination-mismatch',
  'url.ip-address-host',
  'url.embedded-credentials',
  'url.punycode-host',
  'url.shortener',
  'url.misleading-company-domain',
  'url.suspicious-host',
  'company.identity-consistency',
  'company.official-domain-mismatch',
]);

const CATEGORIES = ['content', 'header', 'url', 'company'];

function activeRulesByKey(records) {
  if (!Array.isArray(records)) return new Map();
  return new Map(records
    .filter((rule) => rule?.enabled === true
      && SUPPORTED_RULE_KEYS.has(rule.ruleKey)
      && rule.category === rule.ruleKey.split('.')[0]
      && ['strong', 'moderate', 'weak'].includes(rule.severity))
    .map((rule) => [rule.ruleKey, rule]));
}

function buildNextSteps(findings) {
  const severityOrder = { strong: 0, moderate: 1, weak: 2 };
  const topicOrder = { credentials: 0, payment: 1, personalData: 2, link: 3, urgency: 4, verification: 5 };
  const familyFor = (action) => {
    if (/password|credential|banking|account login/i.test(action)) return 'credentials';
    if (/pay|payment|fee|purchase/i.test(action)) return 'payment';
    if (/identity|personal|financial|passport|aadhaar|aadhar|account number|sensitive/i.test(action)) return 'personalData';
    if (/\blink\b|\burl\b|\bdestination\b/i.test(action)) return 'link';
    if (/pause|respond|response|deadline|immediately|short time/i.test(action)) return 'urgency';
    if (/verify|confirm|contact|independent|company|organization|sender|domain|recruit/i.test(action)) return 'verification';
    return '';
  };
  const candidates = findings
    .filter((finding) => finding.recommendedAction)
    .slice()
    .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
      || (topicOrder[familyFor(left.recommendedAction)] ?? 6) - (topicOrder[familyFor(right.recommendedAction)] ?? 6));
  const actions = [];
  const seenFamilies = new Set();
  const seenActions = new Set();

  for (const finding of candidates) {
    const action = finding.recommendedAction.trim();
    const family = familyFor(action);
    const normalized = action.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seenActions.has(normalized) || (family && seenFamilies.has(family))) continue;
    actions.push(action);
    seenActions.add(normalized);
    if (family) seenFamilies.add(family);
  }

  if (!actions.length) actions.push('Verify the organization and opportunity through contact details you find independently.');
  actions.push('Treat this report as a set of indicators, not proof that an offer is fraudulent or legitimate.');
  return actions.slice(0, 5);
}

function addDisabledCategoryNotes(unknowns, rules, records) {
  const activeCategories = new Set([...rules.values()].map((rule) => rule.category));
  for (const category of CATEGORIES) {
    if (!activeCategories.has(category)) {
      unknowns.push(`No enabled ${category} rules were loaded, so those checks were unavailable.`);
      continue;
    }
    const supportedInCategory = [...SUPPORTED_RULE_KEYS].filter((key) => key.startsWith(`${category}.`));
    const missingOrDisabled = supportedInCategory.some((key) => {
      const record = records.find((rule) => rule?.ruleKey === key);
      return !rules.has(key) || !record || record.enabled !== true;
    });
    if (missingOrDisabled) {
      unknowns.push(`Some ${category} checks were skipped because one or more configured rules are missing or disabled.`);
    }
  }
}

export function createAnalysisEngine({ loadRules = loadDetectionRules } = {}) {
  return async function analyze(submission) {
    let records;
    try {
      records = await loadRules();
    } catch {
      throw new RuleDataUnavailableError();
    }

    const rules = activeRulesByKey(records);
    if (!rules.size) throw new RuleDataUnavailableError();

    const headers = evaluateHeaders(submission.headersText ?? '', rules);
    const companyIdentity = extractCompanyIdentity(submission.emailText);
    const company = evaluateCompany(submission.emailText, headers.senderDomain, rules);
    const urls = evaluateUrls(submission.emailText, rules, {
      senderDomain: headers.senderDomain,
      companyDomain: companyIdentity.officialDomain,
      links: submission.links,
      linksTruncated: submission.linksTruncated,
    });
    const contentFindings = evaluateContent(submission.emailText, rules, company.identity);
    const findings = [
      ...contentFindings,
      ...headers.findings,
      ...urls.findings,
      ...company.findings,
    ];

    const unknowns = [
      ...headers.unknowns,
      ...company.unknowns,
      'Any claimed school or institutional affiliation and recruitment authorization could not be independently verified from this submission; different sender domains can have legitimate explanations.',
      'Company names and domains were compared only for consistency; no paid, live registry, or reputation lookup was used.',
    ];
    if (!urls.linkMetadataProvided) {
      unknowns.push('No rich-text hyperlink destination metadata was available. Plain-text checks can inspect visible URLs but cannot reveal a hidden link destination.');
    } else if (urls.unmatchedLinkCount) {
      unknowns.push('Some captured hyperlink destinations were ignored because their displayed text was not present in the submitted email.');
    }
    if (urls.unparseableLinkCount) {
      unknowns.push('Some captured hyperlink destinations were not absolute, parseable URLs and could not be checked.');
    }
    if (urls.linksTruncated) {
      unknowns.push('Rich clipboard link metadata was limited by input-size caps; some hyperlink destinations may not have been analyzed.');
    }
    if (urls.urls.length) {
      unknowns.push('Visible URLs and supplied hyperlink destinations were normalized and checked statically. No webpage was visited, no redirects were followed, and no live URL reputation service was queried.');
    } else {
      unknowns.push('No analyzable web URL was found in the pasted text or supplied hyperlink metadata.');
    }
    addDisabledCategoryNotes(unknowns, rules, records);

    const riskCategory = classifyFindings(submission.emailText, findings);
    return {
      status: 'complete',
      report: {
        riskCategory,
        summary: summarizeRisk(riskCategory),
        classificationExplanation: classificationExplanation(findings, riskCategory),
        findings,
        unknowns: [...new Set(unknowns)],
        nextSteps: buildNextSteps(findings),
      },
    };
  };
}

export const analyzeEmail = createAnalysisEngine();

export function isAnalysisReport(report) {
  const validFinding = (finding) => finding
    && typeof finding.ruleKey === 'string'
    && ['content', 'header', 'url', 'company'].includes(finding.category)
    && typeof finding.title === 'string'
    && ['strong', 'moderate', 'weak'].includes(finding.severity)
    && typeof finding.explanation === 'string'
    && typeof finding.evidence === 'string'
    && typeof finding.recommendedAction === 'string';

  return report
    && ['low', 'medium', 'high', 'insufficient_information'].includes(report.riskCategory)
    && typeof report.summary === 'string'
    && typeof report.classificationExplanation === 'string'
    && Array.isArray(report.findings)
    && report.findings.every(validFinding)
    && Array.isArray(report.unknowns)
    && report.unknowns.every((item) => typeof item === 'string')
    && Array.isArray(report.nextSteps)
    && report.nextSteps.every((item) => typeof item === 'string');
}
