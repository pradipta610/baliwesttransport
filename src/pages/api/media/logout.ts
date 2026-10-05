import { handler, json, SESSION_COOKIE } from '../../../lib/media/server';

export const prerender = false;

export const POST = handler(
  async (ctx) => {
    ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
    return json({ ok: true });
  },
  { auth: false },
);
