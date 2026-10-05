import { MAX_FILES_PER_COMMIT } from '../../../lib/media/config';
import { commitChanges, createBlob, readBlob } from '../../../lib/media/github';
import { assertFile, assertUnused, folderExists, folderOf, usedFiles } from '../../../lib/media/library';
import { handler, HttpError, json } from '../../../lib/media/server';
import { validateMedia } from '../../../lib/media/validate';

export const prerender = false;

interface Incoming {
  path: string;
  chunks: string[];
  replace?: boolean;
}

// Reassembles uploaded chunks, validates the real bytes (guard 2) and commits
// the whole batch as a single commit.
export const POST = handler(async (ctx) => {
  const { files } = (await ctx.request.json().catch(() => ({}))) as { files?: Incoming[] };
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_COMMIT)
    throw new HttpError(400, `Kirim 1–${MAX_FILES_PER_COMMIT} file per upload.`);

  const ready: Array<{ path: string; sha: string; replace: boolean }> = [];
  for (const f of files) {
    const path = assertFile(f.path);
    if (!Array.isArray(f.chunks) || f.chunks.length === 0 || f.chunks.some((s) => !/^[0-9a-f]{40}$/.test(s)))
      throw new HttpError(400, `Data upload ${path} tidak lengkap.`);

    const parts = await Promise.all(f.chunks.map(readBlob));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    validateMedia(path, bytes);
    ready.push({ path, sha: f.chunks.length === 1 ? f.chunks[0] : await createBlob(bytes), replace: !!f.replace });
  }

  const replacing = ready.filter((f) => f.replace).map((f) => f.path);
  if (replacing.length) assertUnused(replacing, await usedFiles(ctx));

  const folders = [...new Set(ready.map((f) => folderOf(f.path)))];
  const commit = await commitChanges(`upload ${ready.length} file ke ${folders.join(', ')}`, (entries) => {
    for (const folder of folders)
      if (!folderExists(entries, folder)) throw new HttpError(404, `Folder ${folder} tidak ditemukan.`);
    for (const f of ready)
      if (!f.replace && entries.some((e) => e.path === f.path)) throw new HttpError(409, `File ${f.path} sudah ada.`);
    return ready.map((f) => ({ path: f.path, sha: f.sha }));
  });
  return json({ commit });
});
