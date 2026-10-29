import { useState } from 'react';
import AnalysisResult from './AnalysisResult.jsx';
import { extractRichClipboardLinks, normalizeLinkText } from './clipboardLinks.js';

const MAX_EMAIL_BYTES = 48 * 1024;
const MAX_HEADERS_BYTES = 12 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export default function App() {
  const [emailText, setEmailText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [pastedLinks, setPastedLinks] = useState([]);
  const [linksTruncated, setLinksTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!emailText.trim()) {
      setError('Paste the complete internship email to continue.');
      return;
    }
    if (byteLength(emailText.trim()) > MAX_EMAIL_BYTES) {
      setError('The email is too large. The maximum email size is 48 KiB.');
      return;
    }
    if (byteLength(headersText) > MAX_HEADERS_BYTES) {
      setError('The headers are too large. The maximum header size is 12 KiB.');
      return;
    }

    const submission = { emailText, headersText };
    if (pastedLinks.length || linksTruncated) {
      submission.links = pastedLinks;
      submission.linksTruncated = linksTruncated;
    }
    const requestBody = JSON.stringify(submission);
    if (byteLength(requestBody) > MAX_REQUEST_BYTES) {
      setError('The combined email, headers, and link information exceed the request size limit.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? 'InternShield could not process this submission. Please try again.');
        return;
      }
      if (payload?.status !== 'complete' || !payload.report) {
        setError('InternShield returned an unexpected response. Please try again.');
        return;
      }
      setResult(payload);
    } catch {
      setError('We could not reach InternShield. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleEmailPaste(event) {
    const clipboard = event.clipboardData;
    const hasHtml = Array.from(clipboard?.types ?? []).includes('text/html');
    if (!hasHtml) {
      setPastedLinks([]);
      setLinksTruncated(false);
      return;
    }

    const captured = extractRichClipboardLinks(clipboard.getData('text/html'));
    setPastedLinks((current) => {
      const combined = [...current, ...captured.links];
      const unique = [...new Map(combined.map((link) => [`${link.text}\u0000${link.href}`, link])).values()];
      return unique.slice(0, 40);
    });
    setLinksTruncated((current) => current || captured.truncated || pastedLinks.length + captured.links.length > 40);
  }

  function handleEmailChange(value) {
    setEmailText(value);
    const normalizedText = normalizeLinkText(value);
    setPastedLinks((current) => current.filter((link) => normalizedText.includes(normalizeLinkText(link.text))));
    if (!value.trim()) setLinksTruncated(false);
  }

  function resetForm() {
    setEmailText('');
    setHeadersText('');
    setPastedLinks([]);
    setLinksTruncated(false);
    setError('');
    setResult(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="InternShield home">
          <span className="brand-mark" aria-hidden="true">IS</span>
          <span>Intern<span className="brand-light">Shield</span></span>
        </a>
        <span className="phase-pill"><span className="status-dot" /> Email review</span>
      </header>

      {result ? (
        <AnalysisResult result={result} onReset={resetForm} />
      ) : (
        <>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow">Student email security · offer review</p>
              <h1 id="hero-title">Check the details.<br /><em>Then decide.</em></h1>
              <p className="intro">
                Paste the complete internship email. If you have them, include the original
                headers too. InternShield checks explainable signals and shows what remains
                unknown so you can decide what to verify independently.
              </p>
              <div className="notice" role="note">
                <span className="notice-icon" aria-hidden="true">i</span>
                <p><strong>Use this as a first-pass review.</strong> Findings are indicators, not
                  proof of fraud. Analysis requires the configured MongoDB detection rules.</p>
              </div>
              <div className="review-scope" aria-label="What InternShield reviews">
                <div className="scope-row">
                  <span className="scope-index" aria-hidden="true">01</span>
                  <p><strong>Offer language</strong><span>Payment requests, personal data, pressure, and missing details.</span></p>
                </div>
                <div className="scope-row">
                  <span className="scope-index" aria-hidden="true">02</span>
                  <p><strong>Sender context</strong><span>Original headers, when you have them.</span></p>
                </div>
                <div className="scope-row">
                  <span className="scope-index" aria-hidden="true">03</span>
                  <p><strong>Link structure</strong><span>Visible and captured destinations; links are never opened.</span></p>
                </div>
              </div>
            </div>

            <section className="form-card" aria-labelledby="form-heading">
              <div className="form-heading">
                <p className="eyebrow">Private email review</p>
                <h2 id="form-heading">Share the offer email</h2>
                <p>Paste the full message, including the sender and any links.</p>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="field-group">
                  <label htmlFor="email-text">Internship email <span className="required-mark">Required</span></label>
                  <textarea
                    id="email-text"
                    name="emailText"
                    value={emailText}
                    onChange={(event) => handleEmailChange(event.target.value)}
                    onPaste={handleEmailPaste}
                    placeholder="Paste the complete email message here…"
                    rows={9}
                    aria-describedby="email-hint"
                    required
                  />
                  <p className="field-hint" id="email-hint">Include the full message. Maximum size: 48 KiB. Rich clipboard pastes may also provide hidden link destinations; plain-text pastes cannot.</p>
                  {(pastedLinks.length > 0 || linksTruncated) && <p className="field-hint" aria-live="polite">Captured {pastedLinks.length} hyperlink destination{pastedLinks.length === 1 ? '' : 's'} from rich clipboard data. Only link text and destinations are sent for this analysis.{linksTruncated ? ' Some links were omitted at the size limit.' : ''}</p>}
                </div>

                <div className="field-group">
                  <label htmlFor="headers-text">Original email headers <span className="optional-mark">Optional</span></label>
                  <textarea
                    id="headers-text"
                    name="headersText"
                    value={headersText}
                    onChange={(event) => setHeadersText(event.target.value)}
                    placeholder="Paste the original headers here, if available…"
                    rows={4}
                    aria-describedby="headers-hint"
                  />
                  <p className="field-hint" id="headers-hint">Headers can provide extra context. Maximum size: 12 KiB.</p>
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}

                <button className="primary-button" type="submit" disabled={loading}>
                  {loading ? <><span className="spinner" aria-hidden="true" /> Analyzing email…</> : 'Analyze email'}
                </button>
              </form>

              <div className="privacy-note" role="note">
                <span className="privacy-icon" aria-hidden="true">●</span>
                <p><strong>Your submission is not saved.</strong> Email text, headers, captured link text and destinations, and generated
                  reports are not stored in the database or application logs. This page keeps
                  the temporary submission in memory until you return to the form or reload.</p>
              </div>
            </section>
          </section>

          <footer>
            <span>InternShield</span>
            <span>Thoughtful checks. Clear explanations.</span>
          </footer>
        </>
      )}
    </main>
  );
}
