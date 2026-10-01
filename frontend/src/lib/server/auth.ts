import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { redirect, error, type Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'htm_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

// Keyed on the password itself, so changing SITE_PASSWORD logs every browser out.
function sign(payload: string): string | null {
  const password = process.env.SITE_PASSWORD;
  if (!password) return null;
  return createHmac('sha256', password).update(`htm-session:${payload}`).digest('base64url');
}

export function createSession(expiresAt = Date.now() + SESSION_MAX_AGE_S * 1000): string {
  return `${expiresAt}.${sign(String(expiresAt))}`;
}

export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const [expiry, sig] = value.split('.');
  const expected = sign(expiry);
  if (!expected || !sig || !tokensMatch(sig, expected)) return false;
  return Number(expiry) > Date.now();
}

/** Constant-time compare; an unset or empty secret never matches. */
export function tokensMatch(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || given == null) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Only same-site paths survive the round trip through /login?next=. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

export function isLoggedIn(cookies: Cookies): boolean {
  return verifySession(cookies.get(SESSION_COOKIE));
}

/**
 * Called from every +page.server.ts, not just the root layout: a client-side
 * __data.json request can skip an unchanged layout load, so the layout alone
 * does not guard page data.
 */
export function requireLogin(cookies: Cookies, url: URL): void {
  if (!isLoggedIn(cookies)) {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}

export function bearerAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  return !!match && tokensMatch(match[1], process.env.API_TOKEN);
}

export function requireBearer(request: Request): void {
  if (!bearerAuthorized(request)) error(401, 'Unauthorized');
}
