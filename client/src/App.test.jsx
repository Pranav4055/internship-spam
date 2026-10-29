// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

const report = {
  riskCategory: 'medium',
  summary: 'The message contains a few details to verify independently.',
  classificationExplanation: 'Medium means at least one moderate or strong finding was present.',
  findings: [{
    ruleKey: 'header.sender-mismatch',
    category: 'header',
    title: 'Sender mismatch',
    severity: 'moderate',
    explanation: 'The reply address uses a different domain.',
    evidence: 'From and Reply-To domains differ.',
    recommendedAction: 'Verify the sender independently.',
  }],
  unknowns: ['Authentication results were not included.'],
  nextSteps: ['Contact the company using a number from its official website.'],
};

function apiResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function fillEmail(value = 'Hello, here is your internship offer.') {
  fireEvent.change(screen.getByLabelText(/Internship email/), { target: { value } });
}

async function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Analyze email' }));
}

describe('email submission and report flow', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders required email and optional header fields with the privacy notice', () => {
    render(<App />);
    expect(screen.getByLabelText(/Internship email/).required).toBe(true);
    expect(screen.getByLabelText(/Original email headers/).required).toBe(false);
    expect(screen.getByText(/Email text, headers, captured link text and destinations, and generated reports are not stored/)).toBeTruthy();
  });

  it('shows a validation error for empty input without calling the API', async () => {
    render(<App />);
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Paste the complete internship email');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks an oversized email in the browser before submission', async () => {
    render(<App />);
    fillEmail('é'.repeat(24 * 1024 + 1));
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('maximum email size is 48 KiB');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows loading state and then renders the report for a valid email', async () => {
    let resolveRequest;
    fetch.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<App />);
    fillEmail();
    fireEvent.change(screen.getByLabelText(/Original email headers/), { target: { value: 'From: recruiter@example.test' } });
    await submit();

    expect(screen.getByRole('button', { name: /Analyzing email/ }).disabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      emailText: 'Hello, here is your internship offer.',
      headersText: 'From: recruiter@example.test',
    });

    resolveRequest(apiResponse(200, { status: 'complete', report }));
    expect(await screen.findByRole('heading', { name: 'Review the evidence.' })).toBeTruthy();
  });

  it('renders all report sections when the analysis interface returns a report', async () => {
    fetch.mockResolvedValueOnce(apiResponse(200, { status: 'complete', report }));
    render(<App />);
    fillEmail();
    await submit();

    expect(await screen.findByRole('heading', { name: 'Review the evidence.' })).toBeTruthy();
    expect(screen.getByText('Medium risk indicators')).toBeTruthy();
    const findingTitle = screen.getByText(report.findings[0].title);
    expect(findingTitle.tagName).toBe('STRONG');
    expect(findingTitle.parentElement?.children.length).toBe(2);
    const severityBadge = screen.getByText('Severity: moderate');
    expect(severityBadge.getAttribute('aria-label')).toBe('Severity: moderate');
    expect(severityBadge.textContent).toBe('Severity: moderate');
    expect(findingTitle.parentElement.textContent).toBe('Sender mismatch Severity: moderate');
    expect(screen.getByText(report.findings[0].explanation)).toBeTruthy();
    expect(screen.getByText(report.findings[0].evidence)).toBeTruthy();
    expect(screen.getByText(report.findings[0].recommendedAction)).toBeTruthy();
    expect(screen.getByText(report.unknowns[0])).toBeTruthy();
    expect(screen.getByText(report.nextSteps[0])).toBeTruthy();
    expect(screen.getByText(/not proof of fraud or legitimacy/)).toBeTruthy();
  });

  it('captures a rich clipboard link destination separately from the visible email text', async () => {
    const displayed = 'https://RegistrationPortal/dsu.edu.in';
    const href = 'https://forms.cloud.microsoft/r/eemriNec50';
    fetch.mockResolvedValueOnce(apiResponse(200, { status: 'complete', report }));
    render(<App />);
    const textarea = screen.getByLabelText(/Internship email/);
    fireEvent.paste(textarea, {
      clipboardData: {
        types: ['text/plain', 'text/html'],
        getData: (type) => type === 'text/html' ? `<a href="${href}">${displayed}</a>` : displayed,
      },
    });
    fillEmail(`Hello, here is your internship offer. ${displayed}`);
    await submit();

    const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(requestBody.emailText).toContain(displayed);
    expect(requestBody.links).toEqual([{ text: displayed, href }]);
    expect(screen.getByText(/Captured 1 hyperlink destination/)).toBeTruthy();
  });

  it('renders report evidence containing markup as text rather than executable HTML', async () => {
    const markup = '<img src=x onerror="alert(1)">';
    const htmlLikeReport = {
      ...report,
      findings: [{ ...report.findings[0], evidence: markup }],
    };
    fetch.mockResolvedValueOnce(apiResponse(200, { status: 'complete', report: htmlLikeReport }));
    render(<App />);
    fillEmail();
    await submit();

    const evidence = await screen.findByText(markup);
    expect(evidence.tagName).toBe('BLOCKQUOTE');
    expect(evidence.querySelector('img')).toBeNull();
  });

  it('returns to a cleared form to analyze another email', async () => {
    fetch.mockResolvedValueOnce(apiResponse(200, { status: 'complete', report }));
    render(<App />);
    fillEmail();
    await submit();
    await screen.findByRole('heading', { name: 'Review the evidence.' });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze another email' }));

    expect(screen.getByLabelText(/Internship email/).value).toBe('');
    expect(screen.getByLabelText(/Original email headers/).value).toBe('');
  });

  it('shows safe errors for API and network failures', async () => {
    fetch.mockResolvedValueOnce(apiResponse(503, {
      status: 'unavailable',
      error: 'Email analysis is temporarily unavailable because required detection rules could not be loaded.',
    }));
    fetch.mockResolvedValueOnce(apiResponse(500, { error: 'An unexpected server error occurred.' }));
    render(<App />);
    fillEmail();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('required detection rules could not be loaded');
    expect(screen.getByLabelText(/Internship email/).value).toContain('internship offer');

    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('An unexpected server error occurred.');
    expect(screen.getByLabelText(/Internship email/).value).toContain('internship offer');

    fetch.mockRejectedValueOnce(new Error('sensitive request details'));
    await submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('We could not reach InternShield'));
    expect(screen.getByRole('alert').textContent).not.toContain('sensitive request details');
  });
});
