const CLASSIFICATION_EXPLANATION = 'Findings are grouped into signal categories: Content covers the email wording and offer details; Header covers pasted sender and authentication fields; URL covers static link structure; Company covers labeled employer details compared with the sender domain. High requires at least one strong finding plus a strong or moderate finding in another category. Medium means at least one strong or moderate finding was present. Low means the message had at least eight word tokens of two or more letters or digits and no strong or moderate findings. Insufficient information means fewer than eight such tokens were supplied and no strong or moderate findings were present. Weak indicators do not raise the category. These categories describe signals, not the probability of fraud.';

function meaningfulWordCount(text) {
  return text.match(/[\p{L}\p{N}]{2,}/gu)?.length ?? 0;
}

export function classifyFindings(text, findings) {
  const strong = findings.filter((finding) => finding.severity === 'strong');
  const elevated = findings.filter((finding) => ['strong', 'moderate'].includes(finding.severity));
  const independentCategories = new Set(elevated.map((finding) => finding.category));

  if (strong.length > 0 && independentCategories.size >= 2) return 'high';
  if (elevated.length > 0) return 'medium';
  if (meaningfulWordCount(text) < 8) return 'insufficient_information';
  return 'low';
}

export function classificationExplanation(findings = [], riskCategory) {
  if (riskCategory !== 'medium') return CLASSIFICATION_EXPLANATION;

  const elevated = findings.filter((finding) => ['strong', 'moderate'].includes(finding.severity));
  const categories = new Set(elevated.map((finding) => finding.category));
  const strong = elevated.filter((finding) => finding.severity === 'strong');
  if (strong.length && categories.size === 1) {
    const category = strong[0].category;
    const label = { content: 'Content', header: 'Header', url: 'URL', company: 'Company' }[category] ?? category;
    return `${CLASSIFICATION_EXPLANATION} In this report, all strong and moderate findings are ${label} signals, so they do not meet the cross-category requirement for High; the category remains Medium.`;
  }
  return CLASSIFICATION_EXPLANATION;
}

export function summarizeRisk(riskCategory) {
  switch (riskCategory) {
    case 'high':
      return 'Strong indicators were found across multiple signal categories. This warrants caution, but it does not prove that the offer is fraudulent.';
    case 'medium':
      return 'One or more strong or moderate indicators deserve independent verification. This assessment is based only on the submitted text and headers.';
    case 'insufficient_information':
      return 'The submitted text contained too few words for a meaningful assessment. Weak observations, if any, are listed below.';
    default:
      return 'Few strong or moderate indicators were detected by the available rules. The absence of warnings is not proof that the offer or company is legitimate.';
  }
}
