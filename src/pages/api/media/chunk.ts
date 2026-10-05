import { CHUNK_BYTES } from '../../../lib/media/config';
import { createBlob } from '../../../lib/media/github';
import { handler, HttpError, json } from '../../../lib/media/server';

export const prerender = false;

// Stores one raw piece of a file as a git blob. Nothing is committed here —
// /api/media/commit reassembles, validates and commits the pieces.
export const POST = handler(async ({ request }) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES) throw new HttpError(413, 'Potongan upload tidak valid.');
  return json({ sha: await createBlob(bytes) });
});
