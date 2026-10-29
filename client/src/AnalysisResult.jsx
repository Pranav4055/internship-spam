export default function AnalysisResult({ result, onReset }) {
  const report = result.report;
  const category = report.riskCategory;
  const categoryLabels = {
    low: 'Low risk indicators',
    medium: 'Medium risk indicators',
    high: 'High risk indicators',
    insufficient_information: 'Insufficient information',
  };
  const label = categoryLabels[category];

  return (
    <section className="result-page" aria-labelledby="result-title">
      <button className="back-link" type="button" onClick={onReset}>Back to email form</button>
      <div className="report-header">
        <div>
          <p className="eyebrow">InternShield report</p>
          <h1 id="result-title">Review the evidence.</h1>
        </div>
        <span className={`risk-badge risk-${category}`}>{label}</span>
      </div>
      <p className="risk-caveat">This category summarizes observed indicators. It is not proof of fraud or legitimacy, and no numeric probability is calculated.</p>
      <section className="report-summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
        <p>{report.summary}</p>
      </section>
      <div className="report-columns">
        <section className="report-section" aria-labelledby="findings-heading">
          <h2 id="findings-heading">Findings</h2>
          {report.findings.length ? <ul className="finding-list">{report.findings.map((finding, index) => (
            <li key={`${finding.ruleKey}-${index}`}>
              <div className="finding-title-row">
                <strong>{finding.title}</strong>
                {' '}
                <span
                  className={`severity-badge severity-${finding.severity}`}
                  aria-label={`Severity: ${finding.severity}`}
                >
                  Severity: {finding.severity}
                </span>
              </div>
              <p>{finding.explanation}</p>
              <blockquote>{finding.evidence}</blockquote>
              <p className="finding-action"><strong>Suggested action:</strong> {finding.recommendedAction}</p>
            </li>
          ))}</ul> : <p className="empty-report-copy">No configured warning indicators were found. That does not establish that the offer is legitimate.</p>}
        </section>
        <section className="report-section" aria-labelledby="unknowns-heading">
          <h2 id="unknowns-heading">Unknowns &amp; limitations</h2>
          <ul className="plain-list">{report.unknowns.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </section>
      </div>
      <section className="classification-note" aria-labelledby="classification-heading">
        <h2 id="classification-heading">How this category is assigned</h2>
        <p>{report.classificationExplanation}</p>
      </section>
      <section className="report-section next-steps" aria-labelledby="next-steps-heading">
        <h2 id="next-steps-heading">Recommended next steps</h2>
        <ol className="plain-list">{report.nextSteps.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
      </section>
      <button className="primary-button result-button" type="button" onClick={onReset}>Analyze another email</button>
    </section>
  );
}
