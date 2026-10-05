import { checkPassword, createSession, handler, HttpError, json } from '../../../lib/media/server';

export const prerender = false;

export const POST = handler(
  async (ctx) => {
    const { password } = await ctx.request.json().catch(() => ({}));
    if (typeof password !== 'string' || !(await checkPassword(password))) {
      await new Promise((r) => setTimeout(r, 1000)); // slows down password guessing
      throw new HttpError(401, 'Password salah.');
    }
    await createSession(ctx);
    return json({ ok: true });
  },
  { auth: false },
);
