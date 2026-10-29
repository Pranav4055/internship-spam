import { DetectionRule } from '../models/DetectionRule.js';

const VERSION = 2;
const PERSONAL_DATA_RULE_VERSION = 3;

export const starterRules = [
  {
    ruleKey: 'content.upfront-payment',
    category: 'content',
    severity: 'strong',
    description: 'A request to pay an internship-related fee or purchase is a strong warning signal.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      groups: [
        ['pay', 'payment', 'transfer', 'send', 'deposit', 'purchase', 'buy'],
        ['registration fee', 'training fee', 'security fee', 'security deposit', 'placement fee', 'application fee', 'processing fee', 'equipment fee', 'fee'],
      ],
      title: 'Request for an upfront fee or purchase',
      explanation: 'The message appears to ask for payment or a purchase connected to the internship. Legitimate programs can have costs, but verify any requested payment independently before paying.',
      recommendedAction: 'Do not pay yet. Contact the organization through contact details you find independently.',
    },
  },
  {
    ruleKey: 'content.sensitive-info-request',
    category: 'content',
    severity: 'strong',
    description: 'Requests for credentials or sensitive personal and financial information warrant immediate caution.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      groups: [
        ['send', 'share', 'provide', 'enter', 'submit', 'upload', 'reply with', 'verify'],
        ['password', 'bank credentials', 'bank account password', 'online banking', 'account login', 'bank login', 'bank password'],
      ],
      title: 'Request for credentials or sensitive information',
      explanation: 'The message appears to ask for login credentials or sensitive personal or financial information. That information is not normally needed to evaluate an internship application.',
      recommendedAction: 'Do not share passwords or banking credentials. Verify any identity-document request directly with the organization.',
    },
  },
  {
    ruleKey: 'content.personal-data-request',
    category: 'content',
    severity: 'moderate',
    description: 'Requests for sensitive identity or financial details early in an application deserve verification.',
    enabled: true,
    ruleVersion: PERSONAL_DATA_RULE_VERSION,
    parameters: {
      groups: [
        ['send', 'share', 'provide', 'enter', 'submit', 'upload', 'reply with', 'verify'],
        ['bank account', 'account number', 'card number', 'routing number', 'social security number', 'national id', 'passport', 'ssn', 'tax id', 'aadhaar details', 'aadhaar number', 'aadhaar card', 'aadhaar', 'aadhar details', 'aadhar number', 'aadhar card', 'aadhar', 'government id', 'identity document'],
      ],
      title: 'Request for sensitive personal or financial details',
      explanation: 'The message appears to request sensitive identity or financial details. Some information may be needed after hiring, but it should be verified and should not be required to evaluate an initial internship offer.',
      recommendedAction: 'Do not send identity or financial details until you have independently verified the employer and the secure onboarding process.',
    },
  },
  {
    ruleKey: 'content.urgent-pressure',
    category: 'content',
    severity: 'moderate',
    description: 'Specific immediate deadlines or pressure language may be used to discourage careful review.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      terms: ['act immediately', 'reply immediately', 'respond immediately', 'within 24 hours', 'pay today', 'payment today', 'offer expires today', 'limited time only', 'immediate payment', 'urgent response required'],
      title: 'Pressure to act or pay quickly',
      explanation: 'The message includes language pressing for an unusually quick response or payment. Time pressure alone does not establish fraud, but it can make independent verification harder.',
      recommendedAction: 'Pause and verify the opportunity before responding or paying, even if the stated deadline is short.',
    },
  },
  {
    ruleKey: 'content.guaranteed-selection',
    category: 'content',
    severity: 'moderate',
    description: 'Claims of guaranteed selection or placement without a meaningful process deserve verification.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      groups: [['guaranteed', 'guarantee', 'assured'], ['selection', 'placement', 'position', 'internship', 'job']],
      title: 'Claim of guaranteed selection or placement',
      explanation: 'The message appears to promise a guaranteed internship outcome. A guarantee is not proof of fraud, but it is unusual enough to verify how selection works.',
      recommendedAction: 'Ask for the role description and selection process, then verify them through an independently located company contact.',
    },
  },
  {
    ruleKey: 'content.high-compensation-claim',
    category: 'content',
    severity: 'moderate',
    description: 'Unusually strong earnings claims without experience or role detail merit a closer look.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      terms: ['earn thousands per week', 'unlimited earning potential', 'guaranteed high pay', 'high pay no experience', 'make thousands with no experience', 'huge stipend guaranteed'],
      title: 'Unusually strong compensation claim',
      explanation: 'The message makes a notably strong earnings or compensation claim with little context. Compensation cannot be judged reliably from the amount alone without role, location, and hours.',
      recommendedAction: 'Request written details about duties, hours, pay structure, and who funds the compensation.',
    },
  },
  {
    ruleKey: 'content.missing-details',
    category: 'content',
    severity: 'weak',
    description: 'Several missing role, employer, or recruitment details can make an offer difficult to verify.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      roleTerms: ['role:', 'position:', 'job title', 'responsibilities', 'duties include', 'internship in'],
      recruitmentTerms: ['apply by', 'application deadline', 'interview', 'hiring manager', 'recruiter', 'next step', 'contact us', 'reply to', 'selection process'],
      title: 'Internship details are vague or incomplete',
      explanation: 'The message does not clearly describe multiple basic details such as the role, named employer, or recruitment process. This can also happen in an informal first-contact email.',
      recommendedAction: 'Ask for a written role description, the employer’s full legal or public-facing name, and a clear selection process.',
    },
  },
  {
    ruleKey: 'header.sender-mismatch',
    category: 'header',
    severity: 'moderate',
    description: 'Unrelated sender and reply domains can indicate a routing or identity mismatch and should be checked.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      fields: ['from', 'reply-to', 'return-path'],
      title: 'Sender and reply domains do not match',
      explanation: 'The supplied From and Reply-To domains appear unrelated. Organizations sometimes use recruiting or email-service domains, so this is a signal to verify rather than a conclusion.',
      recommendedAction: 'Confirm the recruiter and reply address through contact information found independently on the organization’s official site.',
    },
  },
  {
    ruleKey: 'header.authentication-failure-claim',
    category: 'header',
    severity: 'moderate',
    description: 'A pasted authentication failure may be concerning, but the supplied text cannot be verified.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      failureTerms: ['spf=fail', 'spf=softfail', 'dkim=fail', 'dmarc=fail', 'dmarc=quarantine', 'dmarc=reject'],
      title: 'Pasted authentication failure claim needs verification',
      explanation: 'The pasted header text claims an authentication failure. These lines are user-supplied and can be altered; InternShield cannot independently verify whether SPF, DKIM, or DMARC actually passed or failed.',
      recommendedAction: 'Treat the pasted result as unverified. Check the original message in your mail provider or ask a trusted administrator to inspect it.',
    },
  },
  {
    ruleKey: 'header.authentication-pass-claim',
    category: 'header',
    severity: 'weak',
    description: 'A pasted authentication pass claim cannot be independently verified from text.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      passTerms: ['spf=pass', 'dkim=pass', 'dmarc=pass'],
      title: 'Pasted authentication pass claim is unverified',
      explanation: 'The pasted header text claims an authentication pass. These lines are user-supplied and can be altered; InternShield has not verified that SPF, DKIM, or DMARC genuinely passed.',
      recommendedAction: 'Do not rely on this pasted claim alone. Check the original message in your mail provider.',
    },
  },
  {
    ruleKey: 'header.return-path-mismatch',
    category: 'header',
    severity: 'weak',
    description: 'A different Return-Path domain may be used by ordinary mail infrastructure but can be checked.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      fields: ['from', 'return-path'],
      title: 'Return-Path domain differs from the sender',
      explanation: 'The supplied Return-Path uses a different domain from From. Mail providers commonly use separate bounce domains, so this difference alone is weak evidence.',
      recommendedAction: 'Check the original message’s authentication details in your mail provider if the sender identity is uncertain.',
    },
  },
  {
    ruleKey: 'url.display-destination-mismatch',
    category: 'url',
    severity: 'moderate',
    description: 'A displayed URL that names a different host from the hyperlink destination should be checked before use.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Displayed URL differs from its destination',
      explanation: 'The visible URL names a different host from the hyperlink destination. This can be legitimate, such as a form hosted by a third-party service; the mismatch alone does not show that the destination is malicious or that the sender is fraudulent.',
      recommendedAction: 'Before submitting information, confirm through the institution’s official site or contact that it uses this form destination.',
    },
  },
  {
    ruleKey: 'url.unusual-scheme',
    category: 'url',
    severity: 'moderate',
    description: 'Links using schemes other than HTTP or HTTPS should not be opened without understanding their purpose.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      allowedSchemes: ['http:', 'https:'],
      title: 'Link uses an unusual URL scheme',
      explanation: 'An embedded link uses a scheme other than the usual web schemes. This can launch an application or perform an unexpected action; the link was not opened.',
      recommendedAction: 'Do not open the link unless you can verify why that scheme is required.',
    },
  },
  {
    ruleKey: 'url.ip-address-host',
    category: 'url',
    severity: 'moderate',
    description: 'A link pointing directly to an IP address is less typical for an internship application.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Link points to an IP address',
      explanation: 'The link host is an IP address rather than a recognizable domain. This is unusual but does not by itself prove the destination is unsafe.',
      recommendedAction: 'Verify the destination with the organization before opening it or entering information.',
    },
  },
  {
    ruleKey: 'url.embedded-credentials',
    category: 'url',
    severity: 'strong',
    description: 'Credentials embedded in a URL can obscure or alter the apparent destination.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Link contains embedded credentials',
      explanation: 'The link includes a username or password before its host. That structure can disguise the actual destination; credentials were removed from the report.',
      recommendedAction: 'Do not open the link. Navigate to the organization’s site using an address you find independently.',
    },
  },
  {
    ruleKey: 'url.punycode-host',
    category: 'url',
    severity: 'weak',
    description: 'A punycode hostname can represent international characters and may resemble another domain.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Link uses an encoded internationalized domain',
      explanation: 'The hostname contains punycode. Many legitimate international domains use it, but visually similar characters can also be confusing.',
      recommendedAction: 'Check the exact hostname carefully and confirm it with an independently found company contact.',
    },
  },
  {
    ruleKey: 'url.shortener',
    category: 'url',
    severity: 'weak',
    description: 'Shortened links hide the final destination until expanded.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      hosts: ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rb.gy', 'rebrand.ly'],
      title: 'Link uses a URL shortener',
      explanation: 'The link uses a shortening service, so its final destination is not visible in the message. Shorteners are also used for legitimate links.',
      recommendedAction: 'Ask the sender for the full destination or verify the link through the organization’s official site.',
    },
  },
  {
    ruleKey: 'url.misleading-company-domain',
    category: 'url',
    severity: 'moderate',
    description: 'A link that embeds the claimed company domain under an unrelated host may be misleading.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Link places a company-like name under another domain',
      explanation: 'The link contains a company domain or name as a subdomain of an unrelated host. The actual host controls the destination; names appearing earlier in the URL do not establish ownership.',
      recommendedAction: 'Do not rely on the displayed company name in the URL. Verify the complete hostname independently.',
    },
  },
  {
    ruleKey: 'url.suspicious-host',
    category: 'url',
    severity: 'weak',
    description: 'Long chains of subdomains can make it harder to see which host controls a link.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      labelCountThreshold: 5,
      title: 'Link uses a deeply nested hostname',
      explanation: 'The link hostname has many subdomain labels. This can be legitimate, but it makes the controlling domain harder to read.',
      recommendedAction: 'Read the hostname from right to left and verify the final domain independently before opening the link.',
    },
  },
  {
    ruleKey: 'company.identity-consistency',
    category: 'company',
    severity: 'weak',
    description: 'Compare an explicitly named employer or official-site domain with the supplied sender domain cautiously.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Company and sender-domain details differ',
      explanation: 'The company name or explicitly labeled official site in the message does not clearly align with the sender domain. Organizations may use different recruitment domains, so verify this independently.',
      recommendedAction: 'Find the company’s contact details independently and ask whether the sender and role are associated with it.',
    },
  },
  {
    ruleKey: 'company.official-domain-mismatch',
    category: 'company',
    severity: 'moderate',
    description: 'An explicitly labeled official company domain that differs from the sender domain merits verification.',
    enabled: true,
    ruleVersion: VERSION,
    parameters: {
      title: 'Claimed company site and sender domain differ',
      explanation: 'The message labels one domain as the company’s official site, but the sender uses an unrelated domain. This may have a legitimate explanation; it is not proof of impersonation.',
      recommendedAction: 'Open the company site using an address you find independently and confirm whether the sender domain is used for recruiting.',
    },
  },
];

export async function seedRules(RuleModel = DetectionRule) {
  for (const rule of starterRules) {
    await RuleModel.updateOne(
      { ruleKey: rule.ruleKey },
      { $setOnInsert: rule },
      { upsert: true, runValidators: true },
    );

    // Upgrade the Phase 1 seeds once. Later seed runs preserve intentional
    // enable/disable and parameter changes made to the current rule version.
    await RuleModel.updateOne(
      {
        ruleKey: rule.ruleKey,
        $or: [{ ruleVersion: { $exists: false } }, { ruleVersion: { $lt: rule.ruleVersion } }],
      },
      { $set: rule },
      { runValidators: true },
    );
  }
  return starterRules.length;
}
