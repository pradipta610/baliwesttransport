import type { APIContext } from 'astro';

// process.env on Vercel at runtime; import.meta.env covers `astro dev`, which
// loads .env into import.meta.env but not into process.env.
export function env(name: string): string {
  const value = process.env[name] ?? (import.meta.env as Record<string, string | undefined>)[name];
  if (!value) throw new HttpError(500, `Server belum dikonfigurasi: ${name} belum di-set.`);
  return value;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/** Wraps an API handler: auth + same-origin check for writes + uniform error JSON. */
export function handler(fn: (ctx: APIContext) => Promise<Response>, { auth = true } = {}) {
  return async (ctx: APIContext): Promise<Response> => {
    try {
      if (ctx.request.method !== 'GET') {
        const origin = ctx.request.headers.get('origin');
        if (origin && origin !== ctx.url.origin) throw new HttpError(403, 'Origin tidak diizinkan.');
      }
      if (auth && !(await isAuthed(ctx))) throw new HttpError(401, 'Sesi habis, silakan login lagi.');
      return await fn(ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Terjadi kesalahan di server. Coba lagi.' }, 500);
    }
  };
}

// ---------------------------------------------------------------- session

export const SESSION_COOKIE = 'bwt_media_session';
const SESSION_HOURS = 12;

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env('MEDIA_SESSION_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function checkPassword(password: string): Promise<boolean> {
  // Compare HMACs rather than raw strings so timing doesn't leak the password length.
  return safeEqual(await hmac(`pw:${password}`), await hmac(`pw:${env('ADMIN_PASSWORD')}`));
}

export async function createSession(ctx: APIContext): Promise<void> {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  ctx.cookies.set(SESSION_COOKIE, `${exp}.${await hmac(`session:${exp}`)}`, {
    httpOnly: true,
    secure: ctx.url.protocol === 'https:',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

async function isAuthed(ctx: APIContext): Promise<boolean> {
  const raw = ctx.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(`session:${exp}`));
}
