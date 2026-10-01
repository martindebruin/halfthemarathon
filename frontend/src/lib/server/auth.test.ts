import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSession, verifySession, safeNext, tokensMatch, bearerAuthorized } from './auth.js';

describe('session cookie', () => {
  beforeEach(() => { process.env.SITE_PASSWORD = 'hemligt'; });
  afterEach(() => { delete process.env.SITE_PASSWORD; });

  it('accepts a session it signed', () => {
    expect(verifySession(createSession())).toBe(true);
  });

  it('rejects a tampered expiry', () => {
    const [, sig] = createSession().split('.');
    expect(verifySession(`${Date.now() + 10 ** 12}.${sig}`)).toBe(false);
  });

  it('rejects an expired session', () => {
    expect(verifySession(createSession(Date.now() - 1000))).toBe(false);
  });

  it('rejects every session once the password changes', () => {
    const s = createSession();
    process.env.SITE_PASSWORD = 'nytt';
    expect(verifySession(s)).toBe(false);
  });

  it('rejects everything when no password is configured', () => {
    const s = createSession();
    delete process.env.SITE_PASSWORD;
    expect(verifySession(s)).toBe(false);
    expect(verifySession(undefined)).toBe(false);
  });
});

describe('safeNext', () => {
  it('keeps local paths', () => {
    expect(safeNext('/run/12?x=1')).toBe('/run/12?x=1');
  });
  it('refuses other origins', () => {
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('tokensMatch', () => {
  it('compares exactly', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
  });
  it('never matches an unset secret', () => {
    expect(tokensMatch('', '')).toBe(false);
    expect(tokensMatch('x', undefined)).toBe(false);
  });
});

describe('bearerAuthorized', () => {
  beforeEach(() => { process.env.API_TOKEN = 'api-secret'; });
  afterEach(() => { delete process.env.API_TOKEN; });

  const req = (h?: string) => new Request('http://x/api/v1/runs', { headers: h ? { authorization: h } : {} });

  it('accepts the configured token', () => {
    expect(bearerAuthorized(req('Bearer api-secret'))).toBe(true);
  });
  it('rejects a wrong, missing or non-bearer credential', () => {
    expect(bearerAuthorized(req('Bearer nope'))).toBe(false);
    expect(bearerAuthorized(req())).toBe(false);
    expect(bearerAuthorized(req('Basic api-secret'))).toBe(false);
  });
});
