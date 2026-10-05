import type { APIRoute } from 'astro';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_ROOT } from '../../lib/media/config';

// Built at deploy time: every /media/... file referenced in src/. The admin
// page reads it to mark files as "Dipakai" and the delete/rename API refuses
// to touch them. A reference to a missing file fails the build, so a broken
// image can never go live (Vercel keeps serving the previous deployment).

export const prerender = true;

const sources = import.meta.glob('/src/**/*.{astro,ts,js,mjs,md,mdx,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const REF_RE = /\/media\/((?:[a-z0-9-]+\/)+[a-z0-9-]+\.(?:webp|mp4))/g;

export const GET: APIRoute = () => {
  const usage: Record<string, string[]> = {};
  for (const [file, text] of Object.entries(sources)) {
    for (const [, path] of text.matchAll(REF_RE)) (usage[path] ??= []).push(file.replace(/^\/src\//, 'src/'));
  }

  const missing = Object.keys(usage).filter((p) => !existsSync(join(process.cwd(), MEDIA_ROOT, p)));
  if (missing.length && import.meta.env.PROD) {
    throw new Error(
      `Media file(s) referenced in code but missing from ${MEDIA_ROOT}/:\n` +
        missing.map((p) => `  /media/${p}  (used in ${usage[p].join(', ')})`).join('\n'),
    );
  }

  return new Response(JSON.stringify({ used: usage, missing }), { headers: { 'content-type': 'application/json' } });
};
