import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getDatabaseStatus } from '../src/db/connect.js';
import { diagnoseMongoError } from '../src/db/mongoDiagnostics.js';
import { seedRules, starterRules } from '../src/db/seedRules.js';
import { DetectionRule } from '../src/models/DetectionRule.js';

test('MongoDB diagnostics distinguish common Atlas connection failures without exposing raw errors', () => {
  const cases = [
    [{ name: 'MongoServerError', code: 18, message: 'Authentication failed for user: private-user password: private-secret' }, 'AUTHENTICATION_FAILED'],
    [{ name: 'MongoNetworkError', code: 'ENOTFOUND', message: 'querySrv ENOTFOUND private-cluster.mongodb.net' }, 'DNS_LOOKUP_FAILED'],
    [{ name: 'MongoNetworkError', code: 'ECONNREFUSED', message: 'querySrv ECONNREFUSED _mongodb._tcp.private-cluster.mongodb.net' }, 'DNS_RESOLVER_REFUSED'],
    [{ name: 'MongoNetworkError', code: 'ETIMEDOUT', message: 'connection timed out' }, 'CONNECTION_TIMEOUT'],
    [{ name: 'MongoServerError', message: 'IP address 192.0.2.4 is not allowed to access this cluster' }, 'ATLAS_IP_ACCESS_RESTRICTED'],
    [{ name: 'MongoNetworkError', code: 'ECONNRESET', message: 'connection reset' }, 'NETWORK_ERROR'],
    [{ name: 'MongoServerError', code: 13, message: 'not authorized on internshield to execute update' }, 'DATABASE_PERMISSION_DENIED'],
    [{ name: 'MongoRuntimeError', message: 'Unable to parse <atlas-hosts> with URL', cause: Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }) }, 'INVALID_CONNECTION_STRING'],
    [{ name: 'MongoServerError', code: 18, codeName: 'AuthenticationFailed', message: 'Authentication failed' }, 'AUTHENTICATION_FAILED'],
    [{ name: 'MongoServerError', code: 93, codeName: 'InvalidReplicaSetConfig', message: 'Invalid replica set configuration' }, 'REPLICA_SET_CONFIGURATION_ERROR'],
  ];

  for (const [error, expectedCode] of cases) {
    const diagnostic = diagnoseMongoError(error, { operation: 'seed' });
    assert.equal(diagnostic.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-user|private-secret|private-cluster|192\.0\.2\.4/i);
  }
});

test('MongoDB diagnostics inspect nested topology errors and distinguish runtime authorization failures', () => {
  const topologyError = {
    name: 'MongoServerSelectionError',
    message: 'Server selection failed',
    reason: {
      servers: new Map([['atlas-host.example:27017', {
        error: Object.assign(new Error('not authorized on internshield to execute find'), {
          name: 'MongoServerError',
          code: 13,
          codeName: 'Unauthorized',
        }),
      }]]),
    },
  };
  assert.equal(diagnoseMongoError(topologyError).code, 'DATABASE_PERMISSION_DENIED');

  const nestedTimeout = {
    name: 'MongoServerSelectionError',
    message: 'Server selection timed out after 10000ms',
    reason: { servers: new Map([['atlas-host.example:27017', {
      error: Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' }),
    }]]) },
  };
  assert.equal(diagnoseMongoError(nestedTimeout).code, 'CONNECTION_TIMEOUT');
});

test('health reports connected API and database without exposing secrets', async () => {
  const response = await request(createApp({ databaseStatus: () => 'connected' }))
    .get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok', database: { status: 'connected' } });
  assert.doesNotMatch(response.text, /mongodb|password|credential|secret/i);
});

test('health reports degraded service when the database is unavailable', async () => {
  const response = await request(createApp({ databaseStatus: () => 'disconnected' }))
    .get('/api/health');

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'degraded', database: { status: 'disconnected' } });
  assert.doesNotMatch(response.text, /mongodb|password|credential|secret/i);
});

test('database readiness maps Mongoose connection states to public status values', () => {
  assert.equal(getDatabaseStatus(0), 'disconnected');
  assert.equal(getDatabaseStatus(1), 'connected');
  assert.equal(getDatabaseStatus(2), 'connecting');
  assert.equal(getDatabaseStatus(mongoose.Connection.STATES.connected), 'connected');
});

test('unknown API paths return a safe JSON not-found response', async () => {
  const response = await request(createApp()).get('/api/not-a-route');
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'API route not found.' });
});

test('malformed and oversized JSON requests receive safe client errors', async () => {
  const app = createApp();
  const malformed = await request(app).post('/api/analyze').set('Content-Type', 'application/json').send('{');
  const oversized = await request(app).post('/api/analyze').set('Content-Type', 'application/json')
    .send(JSON.stringify({ content: 'x'.repeat(70 * 1024) }));

  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'Request body must be valid JSON.' });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { error: 'Request body is too large.' });
});

test('analysis rejects empty, malformed, unexpected, and over-limit fields', async () => {
  const app = createApp();
  const cases = [
    [{}, 'emailText'],
    [{ emailText: '   ' }, 'emailText'],
    [{ emailText: 'Offer', headersText: 42 }, 'headersText'],
    [{ emailText: 'Offer', links: 'not-an-array' }, 'links'],
    [{ emailText: 'Offer', links: [{ text: 'visible', href: 'https://forms.example.test', extra: true }] }, 'links'],
    [{ emailText: 'Offer', unexpected: 'field' }, 'emailText'],
    [{ emailText: 'x'.repeat(48 * 1024 + 1) }, 'emailText'],
    [{ emailText: 'Offer', headersText: 'x'.repeat(12 * 1024 + 1) }, 'headersText'],
  ];

  for (const [body, field] of cases) {
    const response = await request(app).post('/api/analyze').send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.field, field);
    assert.equal(typeof response.body.error, 'string');
    assert.doesNotMatch(response.text, /Offer|xxxx/);
  }
});

test('valid submissions work without optional headers', async () => {
  const response = await request(createApp()).post('/api/analyze').send({ emailText: 'Complete offer email' });
  assert.equal(response.status, 503);
  assert.equal(response.body.status, 'unavailable');
  assert.match(response.body.error, /required detection rules could not be loaded/);
});

test('analysis interface can return a structured report for the results view', async () => {
  const report = {
    riskCategory: 'medium',
    summary: 'A review summary.',
    classificationExplanation: 'A clear classification method.',
    findings: [{ ruleKey: 'header.sender-mismatch', category: 'header', title: 'Sender mismatch', severity: 'moderate', explanation: 'The visible sender differs from reply-to.', evidence: 'From and reply domains differ.', recommendedAction: 'Verify the sender.' }],
    unknowns: ['Authentication results were not provided.'],
    nextSteps: ['Verify the recruiter using the company website.'],
  };
  const response = await request(createApp({ analysis: async () => ({ status: 'complete', report }) }))
    .post('/api/analyze').send({ emailText: 'Offer body' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'complete', report });
});

test('analysis exceptions and invalid reports return generic errors without details', async () => {
  const throwingApp = createApp({ analysis: async () => { throw new Error('private submitted content'); } });
  const throwingResponse = await request(throwingApp).post('/api/analyze').send({ emailText: 'Offer body' });
  assert.equal(throwingResponse.status, 500);
  assert.deepEqual(throwingResponse.body, { error: 'An unexpected server error occurred.' });
  assert.doesNotMatch(throwingResponse.text, /private submitted content|Offer body/);

  const invalidApp = createApp({ analysis: async () => ({ status: 'complete', report: { riskCategory: 'certain fraud' } }) });
  const invalidResponse = await request(invalidApp).post('/api/analyze').send({ emailText: 'Offer body' });
  assert.equal(invalidResponse.status, 500);
  assert.deepEqual(invalidResponse.body, { error: 'An unexpected server error occurred.' });
});

test('analysis endpoint rate-limits repeated requests with a safe retry response', async () => {
  const app = createApp();
  const statuses = [];
  for (let index = 0; index < 11; index += 1) {
    const response = await request(app).post('/api/analyze').send({ emailText: 'An internship offer body.' });
    statuses.push(response.status);
    if (index === 10) {
      assert.equal(response.headers['retry-after'] > 0, true);
      assert.deepEqual(response.body, { error: 'Too many analysis requests. Please try again later.' });
      assert.doesNotMatch(response.text, /internship offer body/i);
    }
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(503));
  assert.equal(statuses[10], 429);
});

test('runtime detection-rule model does not auto-create indexes for a read-only app user', () => {
  assert.equal(DetectionRule.schema.options.autoIndex, false);
});

test('rule seeding is repeatable and preserves rules configured after first insert', async () => {
  const records = new Map();
  const fakeModel = {
    async updateOne(filter, update, options) {
      if (update.$setOnInsert) {
        assert.equal(options.upsert, true);
        if (!records.has(filter.ruleKey)) records.set(filter.ruleKey, structuredClone(update.$setOnInsert));
        return;
      }
      const record = records.get(filter.ruleKey);
      if (record && (record.ruleVersion === undefined || record.ruleVersion < update.$set.ruleVersion)) {
        Object.assign(record, structuredClone(update.$set));
      }
    },
  };

  assert.equal(await seedRules(fakeModel), starterRules.length);
  assert.equal(records.size, starterRules.length);
  assert.ok([...records.values()].every((rule) => rule.enabled === true));
  for (const rule of starterRules) assert.equal(records.get(rule.ruleKey).ruleVersion, rule.ruleVersion);
  records.get('content.upfront-payment').enabled = false;
  records.get('content.upfront-payment').parameters.customNote = 'Keep this customization';
  await seedRules(fakeModel);

  assert.equal(records.size, starterRules.length);
  assert.equal(records.get('content.upfront-payment').enabled, false);
  assert.equal(records.get('content.upfront-payment').parameters.customNote, 'Keep this customization');
  assert.ok([...records.values()].every((rule) => rule.enabled === true || rule.enabled === false));
});

test('rule seeding upgrades prior unversioned disabled defaults to active versioned rules', async () => {
  const legacy = structuredClone(starterRules[0]);
  delete legacy.ruleVersion;
  legacy.enabled = false;
  legacy.parameters = { terms: ['application fee'] };
  const records = new Map([[legacy.ruleKey, legacy]]);
  const fakeModel = {
    async updateOne(filter, update) {
      const record = records.get(filter.ruleKey);
      if (update.$setOnInsert && !record) records.set(filter.ruleKey, structuredClone(update.$setOnInsert));
      else if (update.$set && record && (record.ruleVersion === undefined || record.ruleVersion < update.$set.ruleVersion)) {
        Object.assign(record, structuredClone(update.$set));
      }
    },
  };

  await seedRules(fakeModel);
  assert.equal(records.get(legacy.ruleKey).enabled, true);
  assert.equal(records.get(legacy.ruleKey).ruleVersion, starterRules[0].ruleVersion);
  assert.deepEqual(records.get(legacy.ruleKey).parameters.groups, starterRules[0].parameters.groups);
});

test('rule seeding upgrades only the changed personal-data rule and preserves other current-version edits', async () => {
  const records = new Map(starterRules.map((rule) => [rule.ruleKey, structuredClone(rule)]));
  const personalRule = records.get('content.personal-data-request');
  personalRule.ruleVersion = 2;
  personalRule.parameters.groups[1] = ['passport', 'tax id'];
  const paymentRule = records.get('content.upfront-payment');
  paymentRule.parameters.customNote = 'Preserve the current-version customization';

  const fakeModel = {
    async updateOne(filter, update) {
      if (update.$setOnInsert) return;
      const record = records.get(filter.ruleKey);
      if (record && (record.ruleVersion === undefined || record.ruleVersion < update.$set.ruleVersion)) {
        Object.assign(record, structuredClone(update.$set));
      }
    },
  };

  await seedRules(fakeModel);

  assert.equal(personalRule.ruleVersion, 3);
  assert.ok(personalRule.parameters.groups[1].includes('aadhaar'));
  assert.equal(paymentRule.parameters.customNote, 'Preserve the current-version customization');
});
