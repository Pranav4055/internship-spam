import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { getDatabaseStatus } from './db/connect.js';
import { analyzeEmail, isAnalysisReport } from './analysis/analyzeEmail.js';
import { createAnalysisRateLimit } from './middleware/analysisRateLimit.js';
import { normalizeLinkText } from './analysis/urls.js';

const MAX_EMAIL_BYTES = 48 * 1024;
const MAX_HEADERS_BYTES = 12 * 1024;
const MAX_LINKS = 40;
const MAX_LINK_METADATA_BYTES = 12 * 1024;
const MAX_LINK_FIELD_BYTES = 2048;

function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send a JSON object with the email text.', field: 'emailText' };
  }
  const allowedFields = new Set(['emailText', 'headersText', 'links', 'linksTruncated']);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return { error: 'Only emailText and headersText are accepted.', field: 'emailText' };
  }
  if (typeof body.emailText !== 'string' || !body.emailText.trim()) {
    return { error: 'Paste the complete internship email to continue.', field: 'emailText' };
  }
  const emailText = body.emailText.trim();
  const headersText = body.headersText ?? '';
  if (typeof headersText !== 'string') {
    return { error: 'Headers must be plain text.', field: 'headersText' };
  }
  if (Buffer.byteLength(emailText, 'utf8') > MAX_EMAIL_BYTES) {
    return { error: 'The email is too large. The maximum email size is 48 KiB.', field: 'emailText' };
  }
  if (Buffer.byteLength(headersText, 'utf8') > MAX_HEADERS_BYTES) {
    return { error: 'The headers are too large. The maximum header size is 12 KiB.', field: 'headersText' };
  }
  const links = body.links === undefined ? [] : body.links;
  if (!Array.isArray(links) || links.length > MAX_LINKS) {
    return { error: 'Link metadata is invalid or exceeds the supported limit.', field: 'links' };
  }
  let linksBytes = 0;
  for (const link of links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)
        || Object.keys(link).some((key) => !['text', 'href'].includes(key))
        || typeof link.text !== 'string' || typeof link.href !== 'string'
        || !link.text.trim() || !link.href.trim()
        || Buffer.byteLength(link.text, 'utf8') > MAX_LINK_FIELD_BYTES
        || Buffer.byteLength(link.href, 'utf8') > MAX_LINK_FIELD_BYTES) {
      return { error: 'Link metadata must contain plain text and a destination URL.', field: 'links' };
    }
    linksBytes += Buffer.byteLength(link.text, 'utf8') + Buffer.byteLength(link.href, 'utf8');
  }
  if (linksBytes > MAX_LINK_METADATA_BYTES) {
    return { error: 'Link metadata is too large. The maximum size is 12 KiB.', field: 'links' };
  }
  if (body.linksTruncated !== undefined && typeof body.linksTruncated !== 'boolean') {
    return { error: 'Link metadata status is invalid.', field: 'linksTruncated' };
  }
  const emailForMatch = normalizeLinkText(emailText);
  const validLinks = links.map((link) => ({ text: link.text.trim(), href: link.href.trim() }))
    .filter((link) => emailForMatch.includes(normalizeLinkText(link.text)));
  return {
    emailText,
    headersText: headersText.trim(),
    links: validLinks,
    linksTruncated: body.linksTruncated === true,
  };
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDir, '../../client/dist');

export function createApp({ databaseStatus = getDatabaseStatus, analysis = analyzeEmail } = {}) {
  const app = express();
  const analysisRateLimit = createAnalysisRateLimit();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use('/api/analyze', (request, response, next) => (
    request.method === 'POST' ? analysisRateLimit(request, response, next) : next()
  ));
  app.use(express.json({ limit: '64kb', strict: true }));

  app.get('/api/health', (_request, response) => {
    const dbStatus = databaseStatus();
    const healthy = dbStatus === 'connected';
    response.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database: { status: dbStatus },
    });
  });

  app.post('/api/analyze', async (request, response, next) => {
    const submission = validateSubmission(request.body);
    if (submission.error) {
      return response.status(400).json({ error: submission.error, field: submission.field });
    }

    try {
      const result = await analysis(submission);
      if (result?.status === 'complete' && isAnalysisReport(result.report)) {
        return response.status(200).json({ status: 'complete', report: result.report });
      }
      return next(new Error('Analysis service returned an invalid result.'));
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' });
  });

  app.use(express.static(clientDist, { index: false, fallthrough: true }));
  app.get('/{*path}', (request, response, next) => {
    if (request.method !== 'GET' || path.extname(request.path)) return next();
    response.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) next(error);
    });
  });

  app.use((error, _request, response, _next) => {
    if (error?.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request body is too large.' });
    }
    if (error?.code === 'RULE_DATA_UNAVAILABLE') {
      return response.status(503).json({
        status: 'unavailable',
        error: 'Email analysis is temporarily unavailable because required detection rules could not be loaded.',
      });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}
