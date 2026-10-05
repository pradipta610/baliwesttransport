import { commitChanges, emptyBlob } from '../../../lib/media/github';
import { assertFolder, assertUnused, folderExists, inFolder, KEEP, usedFiles } from '../../../lib/media/library';
import { handler, HttpError, json } from '../../../lib/media/server';

export const prerender = false;

export const POST = handler(async (ctx) => {
  const body = await ctx.request.json().catch(() => ({}));
  const path = assertFolder(body.path);

  if (body.action === 'create') {
    const keep = await emptyBlob();
    const commit = await commitChanges(`buat folder ${path}`, (entries) => {
      if (folderExists(entries, path)) throw new HttpError(409, `Folder ${path} sudah ada.`);
      return [{ path: `${path}/${KEEP}`, sha: keep }];
    });
    return json({ commit });
  }

  if (body.action === 'rename') {
    const to = assertFolder(body.to);
    if (to === path || inFolder(to, path)) throw new HttpError(400, 'Nama folder baru tidak valid.');
    const used = await usedFiles(ctx);
    const commit = await commitChanges(`ganti nama folder ${path} -> ${to}`, (entries) => {
      const moving = entries.filter((e) => inFolder(e.path, path));
      if (!moving.length) throw new HttpError(404, `Folder ${path} tidak ditemukan.`);
      if (folderExists(entries, to)) throw new HttpError(409, `Folder ${to} sudah ada.`);
      assertUnused(moving.map((e) => e.path), used);
      return moving.flatMap((e) => [
        { path: to + e.path.slice(path.length), sha: e.sha },
        { path: e.path, sha: null },
      ]);
    });
    return json({ commit });
  }

  if (body.action === 'delete') {
    const used = await usedFiles(ctx);
    const commit = await commitChanges(`hapus folder ${path}`, (entries) => {
      const doomed = entries.filter((e) => inFolder(e.path, path));
      if (!doomed.length) throw new HttpError(404, `Folder ${path} tidak ditemukan.`);
      assertUnused(doomed.map((e) => e.path), used);
      return doomed.map((e) => ({ path: e.path, sha: null }));
    });
    return json({ commit });
  }

  throw new HttpError(400, 'Aksi tidak dikenal.');
});
