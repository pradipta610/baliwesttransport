import { commitChanges, emptyBlob } from '../../../lib/media/github';
import { assertFile, assertUnused, folderExists, folderOf, inFolder, KEEP, usedFiles } from '../../../lib/media/library';
import { handler, HttpError, json } from '../../../lib/media/server';

export const prerender = false;

// A video's poster (clip.mp4 -> clip-poster.webp) travels with it on delete and rename.
const posterOf = (path: string) => (path.endsWith('.mp4') ? path.replace(/\.mp4$/, '-poster.webp') : null);

export const POST = handler(async (ctx) => {
  const body = await ctx.request.json().catch(() => ({}));
  const used = await usedFiles(ctx);

  if (body.action === 'delete') {
    if (!Array.isArray(body.paths) || body.paths.length === 0) throw new HttpError(400, 'Pilih file yang mau dihapus.');
    const picked = body.paths.map(assertFile) as string[];
    const paths = [...new Set(picked.flatMap((p) => [p, posterOf(p)].filter((x): x is string => !!x)))];
    assertUnused(paths, used);
    const keep = await emptyBlob();
    const commit = await commitChanges(`hapus ${picked.length} file`, (entries) => {
      const changes: Array<{ path: string; sha: string | null }> = paths
        .filter((p) => entries.some((e) => e.path === p))
        .map((p) => ({ path: p, sha: null }));
      // Deleting a folder's last file would make git drop the folder, so keep it open.
      for (const folder of new Set(paths.map(folderOf))) {
        if (!entries.some((e) => inFolder(e.path, folder) && !paths.includes(e.path)))
          changes.push({ path: `${folder}/${KEEP}`, sha: keep });
      }
      return changes;
    });
    return json({ commit });
  }

  if (body.action === 'move') {
    const path = assertFile(body.path);
    const to = assertFile(body.to);
    if (path.split('.').pop() !== to.split('.').pop()) throw new HttpError(400, 'Ekstensi file tidak boleh diubah.');
    const moves = [[path, to]];
    const poster = posterOf(path);
    if (poster) moves.push([poster, posterOf(to)!]);
    assertUnused(moves.map(([from]) => from), used);

    const commit = await commitChanges(`ganti nama ${path} -> ${to}`, (entries) => {
      if (!entries.some((e) => e.path === path)) throw new HttpError(404, `File ${path} tidak ditemukan.`);
      if (!folderExists(entries, folderOf(to))) throw new HttpError(404, `Folder ${folderOf(to)} tidak ditemukan.`);
      return moves.flatMap(([from, dest]) => {
        const file = entries.find((e) => e.path === from);
        if (!file) return [];
        if (entries.some((e) => e.path === dest)) throw new HttpError(409, `File ${dest} sudah ada.`);
        return [
          { path: dest, sha: file.sha },
          { path: from, sha: null },
        ];
      });
    });
    return json({ commit });
  }

  throw new HttpError(400, 'Aksi tidak dikenal.');
});
