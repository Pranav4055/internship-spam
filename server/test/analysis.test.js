import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { analyzeEmail, createAnalysisEngine, isAnalysisReport } from '../src/analysis/analyzeEmail.js';
import { classifyFindings } from '../src/analysis/classify.js';
import { RuleDataUnavailableError } from '../src/analysis/ruleDataError.js';
import { excerptAround } from '../src/analysis/utils.js';
import { decodeHtmlEntities } from '../src/analysis/urls.js';
import { starterRules } from '../src/db/seedRules.js';

const enabledRules = structuredClone(starterRules);
const engine = createAnalysisEngine({ loadRules: async () => enabledRules });

const detailedOffer = [
  'Company: Northstar Analytics',
  'Official website: https://northstar-analytics.com/careers',
  'Role: Data Analyst Intern',
  'Responsibilities: Build reports with the analytics team and document results.',
  'Apply by May 30 using the application page and interview with the hiring manager.',
].join('\n');

async function scan(emailText, headersText = '', links = [], linksTruncated = false) {
  return engine({ emailText, headersText, links, linksTruncated });
}

test('legitimate-looking detailed offer returns low indicators without claiming legitimacy', async () => {
  const result = await scan(detailedOffer, [
    'From: Careers <internships@northstar-analytics.com>',
    'Reply-To: internships@northstar-analytics.com',
    'Return-Path: bounce@northstar-analytics.com',
  ].join('\n'));

  assert.equal(result.status, 'complete');
  assert.equal(result.report.riskCategory, 'low');
  assert.equal(result.report.findings.length, 0);
  assert.match(result.report.summary, /not proof|not.*proof/i);
  assert.match(result.report.unknowns.join(' '), /not independently verified/i);
  assert.equal(isAnalysisReport(result.report), true);
});

test('student skills workshop and course registration do not trigger internship detail warnings', async () => {
  const workshop = [
    'Student Skills Workshop',
    'Join a practical session on communication, teamwork, and interview preparation.',
    'Registration is open for the June 12 session. Bring a laptop and your student ID.',
    'Use the Microsoft Forms link to reserve a seat.',
  ].join('\n');
  const result = await scan(workshop);

  assert.ok(!result.report.findings.some((item) => item.ruleKey === 'content.missing-details'));
});

test('an internship offer that omits employer and role details receives the weak details finding', async () => {
  const offer = 'We are pleased to offer you an internship. Please reply by Friday to discuss next steps.';
  const result = await scan(offer);

  assert.ok(result.report.findings.some((item) => item.ruleKey === 'content.missing-details'));
});

test('a paid internship claim in a workshop email still runs payment and details rules', async () => {
  const mixedMessage = [
    'Student Skills Workshop registration is open for next week.',
    'We are also offering a paid internship placement. Pay a registration fee to reserve your opportunity.',
  ].join('\n');
  const result = await scan(mixedMessage);
  const keys = new Set(result.report.findings.map((item) => item.ruleKey));

  assert.ok(keys.has('content.upfront-payment'));
  assert.ok(keys.has('content.missing-details'));
});

test('upfront fee request creates a strong, evidence-backed finding but one category is not high', async () => {
  const body = `${detailedOffer}\nPay a one-time registration fee before the interview.`;
  const result = await scan(body);
  const finding = result.report.findings.find((item) => item.ruleKey === 'content.upfront-payment');

  assert.equal(result.report.riskCategory, 'medium');
  assert.equal(finding.severity, 'strong');
  assert.match(finding.evidence, /registration fee/i);
  assert.match(finding.recommendedAction, /Do not pay/i);
});

test('sensitive-data and urgency requests produce separate explainable findings', async () => {
  const body = `${detailedOffer}\nPlease provide your bank account password and reply immediately within 24 hours to secure selection.`;
  const result = await scan(body);
  const keys = new Set(result.report.findings.map((finding) => finding.ruleKey));

  assert.equal(result.report.riskCategory, 'medium');
  assert.ok(keys.has('content.sensitive-info-request'));
  assert.ok(keys.has('content.urgent-pressure'));
  assert.ok(result.report.findings.every((finding) => finding.evidence && finding.explanation && finding.recommendedAction));
});

test('sensitive identity and financial detail requests are surfaced separately from credential requests', async () => {
  const result = await scan(`${detailedOffer}\nPlease submit your passport number and account number before the interview.`);
  const finding = result.report.findings.find((item) => item.ruleKey === 'content.personal-data-request');

  assert.equal(finding.severity, 'moderate');
  assert.match(finding.evidence, /passport number|account number/i);
  assert.match(finding.recommendedAction, /Do not send/i);
});

test('Aadhaar requests produce a moderate finding and redact the actual identifier', async () => {
  const result = await scan([
    detailedOffer,
    'Please provide your Aadhaar details for onboarding. Aadhaar number: 1234 5678 9012.',
  ].join('\n'));
  const finding = result.report.findings.find((item) => item.ruleKey === 'content.personal-data-request');

  assert.ok(finding);
  assert.equal(finding.severity, 'moderate');
  assert.match(finding.evidence, /Aadhaar/i);
  assert.doesNotMatch(finding.evidence, /1234|5678|9012/);
  assert.match(finding.explanation, /may be needed after hiring/i);
  assert.equal(result.report.riskCategory, 'medium');
  assert.equal((finding.evidence.match(/“/g) ?? []).length, 1);
  assert.match(finding.evidence, /Please provide your Aadhaar details/);
});

test('strong payment plus moderate personal-data and urgency findings in content remain medium', async () => {
  const body = `${detailedOffer}\nPay a registration fee today. Please provide your Aadhaar details and respond immediately.`;
  const result = await scan(body);
  const relevant = result.report.findings.filter((finding) => [
    'content.upfront-payment', 'content.personal-data-request', 'content.urgent-pressure',
  ].includes(finding.ruleKey));

  assert.deepEqual(relevant.map((finding) => finding.category), ['content', 'content', 'content']);
  assert.equal(relevant.find((finding) => finding.ruleKey === 'content.upfront-payment').severity, 'strong');
  assert.equal(relevant.find((finding) => finding.ruleKey === 'content.personal-data-request').severity, 'moderate');
  assert.equal(relevant.find((finding) => finding.ruleKey === 'content.urgent-pressure').severity, 'moderate');
  assert.equal(result.report.riskCategory, 'medium');
  assert.match(result.report.classificationExplanation, /Content covers the email wording and offer details/);
  assert.match(result.report.classificationExplanation, /Header covers pasted sender and authentication fields/);
  assert.match(result.report.classificationExplanation, /URL covers static link structure/);
  assert.match(result.report.classificationExplanation, /Company covers labeled employer details/);
  assert.match(result.report.classificationExplanation, /all strong and moderate findings are Content signals/);
  assert.match(result.report.classificationExplanation, /category remains Medium/);
});

test('evidence excerpts keep complete words and omit URL secrets and unrelated contact values', async () => {
  const text = `Opening context ${'precedingword '.repeat(15)}NEEDLE ${'followingword '.repeat(15)} closing`;
  const start = text.indexOf('NEEDLE');
  const excerpt = excerptAround(text, start, start + 'NEEDLE'.length, 90);

  assert.match(excerpt, /^“…precedingword(?: precedingword)* NEEDLE(?: followingword)+…?”$/u);

  const result = await scan([
    detailedOffer,
    'Please provide Aadhaar details at offers.example/private/path?token=secret javascript:alert(1)?key=secret recruiter@example.test, number 123456789012.',
  ].join('\n'));
  const finding = result.report.findings.find((item) => item.ruleKey === 'content.personal-data-request');
  assert.ok(finding);
  assert.doesNotMatch(finding.evidence, /private|token=secret|alert|key=secret|recruiter@example\.test|123456789012/);
  assert.match(finding.evidence, /offers\.example/);
});

test('consolidated next steps avoid repeating the company verification action', async () => {
  const body = [
    'Company: Acme Robotics',
    'Official website: https://acmerobotics.example/careers',
    'Role: Robotics Engineering Intern',
    'Responsibilities: Test prototypes with the engineering group.',
    'Apply by June 2 and interview with the named hiring manager.',
  ].join('\n');
  const result = await scan(body, [
    'From: recruiter@outside.example',
    'Reply-To: hiring@different-mail.example',
  ].join('\n'));
  const companyVerificationActions = result.report.nextSteps.filter((action) => /company.*independently|contact information found independently|confirm the recruiter/i.test(action));

  assert.equal(companyVerificationActions.length, 1);
  assert.ok(result.report.findings.filter((finding) => finding.category === 'company' || finding.category === 'header')
    .every((finding) => finding.recommendedAction));
});

test('sender/reply mismatch is cautious and pasted fail claims remain unverified', async () => {
  const headers = [
    'From: Recruiter <talent@acme.example>',
    'Reply-To: hr@outside-careers.example',
    'Return-Path: bounce@mailer.example',
    'Authentication-Results: mx.example; spf=fail; dkim=fail; dmarc=fail',
    'Received: from relay.example by mx.example',
  ].join('\n');
  const result = await scan(detailedOffer, headers);

  assert.equal(result.report.riskCategory, 'medium');
  assert.ok(result.report.findings.some((item) => item.ruleKey === 'header.sender-mismatch'));
  assert.ok(result.report.findings.some((item) => item.ruleKey === 'header.authentication-failure-claim'));
  assert.match(result.report.unknowns.join(' '), /user-supplied text/);
  assert.match(result.report.unknowns.join(' '), /Received lines.*not independently verified/);
});

test('pasted authentication passes are never treated as verified passes', async () => {
  const headers = [
    'From: recruiter@northstar-analytics.com',
    'Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass',
  ].join('\n');
  const result = await scan(detailedOffer, headers);
  const passClaim = result.report.findings.find((item) => item.ruleKey === 'header.authentication-pass-claim');

  assert.ok(passClaim);
  assert.equal(passClaim.severity, 'weak');
  assert.match(passClaim.explanation, /has not verified/i);
  assert.match(result.report.unknowns.join(' '), /cannot be confirmed/i);
});

test('missing headers and short content are reported as unavailable or insufficient evidence', async () => {
  const withNoHeaders = await scan(detailedOffer);
  const tooShort = await scan('Hello, you are selected.');

  assert.match(withNoHeaders.report.unknowns.join(' '), /No original headers were provided/);
  assert.equal(tooShort.report.riskCategory, 'insufficient_information');
  assert.ok(tooShort.report.unknowns.length > 0);
});

test('URL checks are static, redact URL credentials and query data, and do not fetch links', async () => {
  const body = `${detailedOffer}\nLinks: javascript:alert(1) https://user:secret@192.0.2.44/form?token=private https://northstar-analytics.com.attacker.example/app https://xn--bcher-kva.example/ https://bit.ly/offer`;
  const result = await scan(body, 'From: recruiter@northstar-analytics.com');
  const keys = new Set(result.report.findings.map((item) => item.ruleKey));

  assert.ok(keys.has('url.unusual-scheme'));
  assert.ok(keys.has('url.ip-address-host'));
  assert.ok(keys.has('url.embedded-credentials'));
  assert.ok(keys.has('url.punycode-host'));
  assert.ok(keys.has('url.shortener'));
  assert.ok(keys.has('url.misleading-company-domain'));
  const urlFindings = result.report.findings.filter((item) => item.category === 'url');
  assert.ok(urlFindings.every((item) => !item.evidence.includes('secret') && !item.evidence.includes('private')));
  assert.match(result.report.unknowns.join(' '), /No webpage was visited/);
});

test('a displayed institutional-looking URL that links to a different host creates a cautious finding', async () => {
  const displayed = 'https://RegistrationPortal/dsu.edu.in';
  const destination = 'https://forms.cloud.microsoft/r/eemriNec50';
  const body = `${detailedOffer}\nDSU internship program application: ${displayed}`;
  const response = await request(createApp({ analysis: engine })).post('/api/analyze').send({
    emailText: body,
    headersText: 'From: internship-coordinator@northstar-analytics.com',
    links: [{ text: displayed, href: destination }],
  });
  const finding = response.body.report?.findings.find((item) => item.ruleKey === 'url.display-destination-mismatch');

  assert.equal(response.status, 200);
  assert.ok(finding);
  assert.equal(finding.category, 'url');
  assert.equal(finding.severity, 'moderate');
  assert.match(finding.evidence, /registrationportal/i);
  assert.match(finding.evidence, /forms\.cloud\.microsoft/i);
  assert.doesNotMatch(finding.evidence, /eemriNec50|\/dsu\.edu\.in/);
  assert.match(finding.explanation, /can be legitimate/i);
  assert.match(finding.recommendedAction, /institution.*official/i);
  assert.equal(response.body.report.riskCategory, 'medium');
  assert.match(response.body.report.unknowns.join(' '), /institutional affiliation and recruitment authorization could not be independently verified/i);
  assert.match(response.body.report.unknowns.join(' '), /No webpage was visited/);
});

test('URL metadata decodes HTML entities in destinations before static parsing', async () => {
  const displayed = 'https://RegistrationPortal/dsu.edu.in';
  const result = await scan(`${detailedOffer}\nApply using ${displayed}`, '', [{
    text: displayed,
    href: 'https://forms.cloud.microsoft/r/eemriNec50?from=email&amp;mode=apply',
  }]);
  const finding = result.report.findings.find((item) => item.ruleKey === 'url.display-destination-mismatch');

  assert.equal(decodeHtmlEntities('a=1&amp;b=2'), 'a=1&b=2');
  assert.ok(finding);
  assert.doesNotMatch(finding.evidence, /from=email|mode=apply|eemriNec50/i);
});

test('plain-text URL input cannot invent or compare an unavailable hidden destination', async () => {
  const displayed = 'https://RegistrationPortal/dsu.edu.in';
  const result = await scan(`${detailedOffer}\nDSU internship program application: ${displayed}`);

  assert.equal(result.report.riskCategory, 'low');
  assert.ok(!result.report.findings.some((item) => item.ruleKey === 'url.display-destination-mismatch'));
  assert.match(result.report.unknowns.join(' '), /cannot reveal a hidden link destination/i);
  assert.match(result.report.unknowns.join(' '), /institutional affiliation and recruitment authorization could not be independently verified/i);
});

test('relative rich-text destinations are not treated as absolute URL mismatches', async () => {
  const displayed = 'https://RegistrationPortal/dsu.edu.in';
  const result = await scan(`${detailedOffer}\nDSU internship program application: ${displayed}`, '', [{
    text: displayed,
    href: '/r/eemriNec50',
  }]);

  assert.ok(!result.report.findings.some((item) => item.ruleKey === 'url.display-destination-mismatch'));
  assert.match(result.report.unknowns.join(' '), /not absolute, parseable URLs/);
});

test('company/domain mismatch is a signal, not a legitimacy or fraud claim', async () => {
  const body = [
    'Company: Acme Robotics',
    'Official website: https://acmerobotics.example/careers',
    'Role: Robotics Engineering Intern',
    'Responsibilities: Test prototypes with the engineering group.',
    'Apply by June 2 and interview with the named hiring manager.',
  ].join('\n');
  const result = await scan(body, 'From: recruiter@outside.example');

  assert.ok(result.report.findings.some((item) => item.ruleKey === 'company.identity-consistency'));
  assert.ok(result.report.findings.some((item) => item.ruleKey === 'company.official-domain-mismatch'));
  assert.match(result.report.unknowns.join(' '), /not independently verified/i);
});

test('generic company label text is not treated as a confidently extracted identity', async () => {
  const result = await scan([
    'Company: We are a fast-growing team',
    'Role: Data Analyst Intern',
    'Responsibilities: Prepare reports and document results for the team.',
    'Apply by May 30 and contact the hiring manager with questions.',
  ].join('\n'));

  assert.match(result.report.unknowns.join(' '), /could not be confidently extracted/);
  assert.ok(!result.report.findings.some((finding) => finding.category === 'company'));
});

test('negated fee and credential phrases do not trigger strong request rules', async () => {
  const body = [
    'Company: Northstar Analytics',
    'Role: Data Analyst Intern',
    'Responsibilities: Prepare reports with the team and document findings.',
    'No registration fee will be collected; never send your password or bank details.',
    'Apply by May 30 and contact the recruiter with questions.',
  ].join('\n');
  const result = await scan(body);
  const keys = new Set(result.report.findings.map((item) => item.ruleKey));

  assert.ok(!keys.has('content.upfront-payment'));
  assert.ok(!keys.has('content.sensitive-info-request'));
  assert.notEqual(result.report.riskCategory, 'high');
});

test('positive company details do not cancel a conflicting fee request', async () => {
  const result = await scan(`${detailedOffer}\nPay a processing fee to confirm your interview.`, 'From: recruiter@northstar-analytics.com');
  assert.ok(result.report.findings.some((item) => item.ruleKey === 'content.upfront-payment'));
  assert.equal(result.report.riskCategory, 'medium');
});

test('classification uses explicit evidence thresholds without a score', () => {
  const finding = (severity, category) => ({ severity, category });
  const enoughText = 'An adequately detailed message contains several meaningful words for review.';
  assert.equal(classifyFindings(enoughText, [finding('weak', 'url')]), 'low');
  assert.equal(classifyFindings(enoughText, [finding('strong', 'content')]), 'medium');
  assert.equal(classifyFindings(enoughText, [finding('strong', 'content'), finding('moderate', 'content')]), 'medium');
  assert.equal(classifyFindings(enoughText, [finding('strong', 'content'), finding('moderate', 'header')]), 'high');
  assert.equal(classifyFindings('Only a short note.', [finding('weak', 'content')]), 'insufficient_information');
});

test('rule database unavailable, empty, or containing only disabled rules fails closed', async () => {
  const unavailable = createAnalysisEngine({ loadRules: async () => { throw new Error('atlas credentials must not leak'); } });
  const missing = createAnalysisEngine({ loadRules: async () => [] });
  const disabled = createAnalysisEngine({ loadRules: async () => starterRules.map((rule) => ({ ...rule, enabled: false })) });
  const submission = { emailText: detailedOffer, headersText: '' };

  for (const analyze of [unavailable, missing, disabled, analyzeEmail]) {
    await assert.rejects(analyze(submission), RuleDataUnavailableError);
  }
});

test('disabled rules are skipped and reported as a coverage limitation', async () => {
  const records = structuredClone(starterRules);
  records.find((rule) => rule.ruleKey === 'content.upfront-payment').enabled = false;
  const partialEngine = createAnalysisEngine({ loadRules: async () => records });
  const result = await partialEngine({
    emailText: `${detailedOffer}\nPay a registration fee to confirm the role.`,
    headersText: '',
  });

  assert.ok(!result.report.findings.some((item) => item.ruleKey === 'content.upfront-payment'));
  assert.match(result.report.unknowns.join(' '), /Some content checks were skipped/);
});

test('API reports rule-data outage safely and never echoes submitted text', async () => {
  const response = await request(createApp({
    analysis: createAnalysisEngine({ loadRules: async () => [] }),
  })).post('/api/analyze').send({ emailText: 'private submitted internship email' });

  assert.equal(response.status, 503);
  assert.equal(response.body.status, 'unavailable');
  assert.doesNotMatch(response.text, /private submitted internship email|atlas credentials/);
});
