import './helpers/env.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { env, isAllowedLogin, roleFor } from '../src/config/env.js';
import { parseDateRange } from '../src/controllers/dashboard.controller.js';
import { assertInsightsShape } from '../src/services/aiInsights.service.js';

// Every case here is decided before any database query runs, so the app needs no MongoDB.
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const ORIGIN = 'http://localhost:5173';
const sub = '64b000000000000000000001';
const cookieFor = (email, claims = {}) => `session=${jwt.sign({ sub, email, name: 'Test', role: 'manager', ...claims }, 'test-jwt-secret', { expiresIn: '1h' })}`;
const call = (path, { method = 'GET', cookie, origin = ORIGIN, body, headers = {} } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('configuration', () => {
  test('CLIENT_ORIGIN is normalised (a trailing slash would fail every CORS check)', () => {
    assert.equal(env.clientOrigin, 'http://localhost:5173');
  });

  // SEC-01
  test('sign-in is limited to the company domain, listed guests, admins and the email sender', () => {
    assert.equal(isAllowedLogin('someone@salasartechno.com'), true);
    assert.equal(isAllowedLogin('owner@gmail.com'), true, 'an admin on a personal address');
    assert.equal(isAllowedLogin('guest@gmail.com'), true, 'listed in ALLOWED_LOGIN_EMAILS');
    assert.equal(isAllowedLogin('stranger@gmail.com'), false);
    assert.equal(isAllowedLogin('x@salasartechno.com.evil.com'), false);
  });

  test('the role comes from ADMIN_EMAILS, case-insensitively', () => {
    assert.equal(roleFor('ADMIN@salasartechno.com'), 'admin');
    assert.equal(roleFor('someone@salasartechno.com'), 'manager');
  });
});

describe('authentication and authorization', () => {
  test('no cookie → 401', async () => {
    assert.equal((await call('/sync/status')).status, 401);
  });

  test('alg:none, forged and expired tokens → 401', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, email: 'admin@salasartechno.com', role: 'admin' })}.`;
    const forged = jwt.sign({ sub, email: 'admin@salasartechno.com', role: 'admin' }, 'dev-only-change-me');
    const expired = jwt.sign({ sub, email: 'admin@salasartechno.com', role: 'admin', exp: Math.floor(Date.now() / 1000) - 5 }, 'test-jwt-secret');
    for (const token of [none, forged, expired]) {
      assert.equal((await call('/sync/status', { cookie: `session=${token}` })).status, 401);
    }
  });

  // SEC-01: a valid session for an account outside the list is refused on every request.
  test('a signed-in account outside the allowed list → 403', async () => {
    assert.equal((await call('/sync/status', { cookie: cookieFor('stranger@gmail.com') })).status, 403);
  });

  // SEC-07: the role claim in the token is ignored; the current configuration decides.
  test('a manager whose token claims admin is still refused admin routes', async () => {
    const res = await call('/sync/run', { method: 'POST', cookie: cookieFor('someone@salasartechno.com', { role: 'admin' }) });
    assert.equal(res.status, 403);
  });

  test('a manager cannot reach the email routes', async () => {
    assert.equal((await call('/email/scheduled', { cookie: cookieFor('someone@salasartechno.com') })).status, 403);
  });
});

describe('request hardening', () => {
  // SEC-04
  test('a state-changing request from another site is refused before it reaches the route', async () => {
    const res = await call('/auth/google/disconnect-drive', { method: 'POST', cookie: cookieFor('admin@salasartechno.com'), origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /Cross-site/);
  });

  // REL-01: the error reaches the error handler as a 400 and the process keeps serving.
  test('an invalid date is a 400, and the server is still up afterwards', async () => {
    const cookie = cookieFor('someone@salasartechno.com');
    for (const q of ['from=garbage', 'from=2026-02-30', 'from=2026-03-02&to=2026-03-01', 'businessUnit=XYZ']) {
      const res = await call(`/dashboard/hsd/summary?${q}`, { cookie });
      assert.equal(res.status, 400, q);
    }
    assert.equal((await call('/health')).status, 200);
  });

  test('a malformed scheduled-email id is a 404, not a crash', async () => {
    const res = await call('/email/scheduled/not-an-object-id', { method: 'DELETE', cookie: cookieFor('pc.hsd@salasartechno.com') });
    assert.equal(res.status, 404);
    assert.equal((await call('/health')).status, 200);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await call('/targets', { method: 'POST', cookie: cookieFor('admin@salasartechno.com'), body: '{"client": ' });
    assert.equal(res.status, 400);
  });

  // SEC-05: the 20 MB email parser only runs for the authorised sender.
  test('an unauthenticated large POST to the email routes is refused without being accepted', async () => {
    const res = await call('/email/send', { method: 'POST', body: { bodyHtml: 'x'.repeat(2_000_000) } });
    assert.equal(res.status, 401);
  });

  test('the ordinary body limit still applies elsewhere', async () => {
    const res = await call('/targets', { method: 'POST', cookie: cookieFor('admin@salasartechno.com'), body: { client: 'x'.repeat(200_000), qty: 1 } });
    assert.equal(res.status, 413);
  });
});

describe('dates and AI output', () => {
  // DA-16: 20:00 UTC on 13 Sep is 01:30 IST on 14 Sep.
  test('"today" is the IST calendar day', () => {
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-09-13T20:00:00Z');
    try {
      const { from, to } = parseDateRange({});
      assert.equal(to.toISOString(), '2026-09-14T23:59:59.999Z');
      assert.equal(from.toISOString(), '2026-08-16T00:00:00.000Z');
    } finally {
      Date.now = realNow;
    }
  });

  test('a range covers whole days, inclusive', () => {
    const { from, to } = parseDateRange({ from: '2026-02-01', to: '2026-02-28' });
    assert.equal(from.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.equal(to.toISOString(), '2026-02-28T23:59:59.999Z');
  });

  // REL-11: a reply missing `insights` used to be cached for a day and crash the dashboard.
  test('AI output that does not match the panel shape is refused', () => {
    assert.throws(() => assertInsightsShape({ headline: 'h', narrative: 'n', recommendations: [] }), /expected shape/);
    assert.throws(() => assertInsightsShape({ headline: 'h', narrative: 'n', insights: [{ title: 't', detail: 'd', severity: 'panic' }], recommendations: [] }));
    const ok = assertInsightsShape({ headline: 'h', narrative: 'n', insights: [{ title: 't', detail: 'd', severity: 'good', extra: 1 }], recommendations: ['r'] });
    assert.deepEqual(ok.insights[0], { title: 't', detail: 'd', severity: 'good' });
  });
});
