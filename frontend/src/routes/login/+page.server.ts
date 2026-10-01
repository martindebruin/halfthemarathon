import { fail, redirect } from '@sveltejs/kit';
import { createSession, isLoggedIn, safeNext, tokensMatch, SESSION_COOKIE, SESSION_MAX_AGE_S } from '$lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ cookies, url }) => {
  if (isLoggedIn(cookies)) redirect(303, safeNext(url.searchParams.get('next')));
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    if (!tokensMatch(password, process.env.SITE_PASSWORD)) {
      // Slows down guessing without needing any state.
      await new Promise((r) => setTimeout(r, 1000));
      return fail(401, { error: 'Fel lösenord' });
    }
    cookies.set(SESSION_COOKIE, createSession(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: SESSION_MAX_AGE_S,
    });
    redirect(303, safeNext(url.searchParams.get('next')));
  },
};
