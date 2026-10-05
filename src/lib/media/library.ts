import type { APIContext } from 'astro';
import { FILE_RE, FOLDER_RE } from './config';
import type { MediaEntry } from './github';
import { HttpError } from './server';

export const KEEP = '.gitkeep'; // git has no empty folders; this file holds one open

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function inFolder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

export function assertFolder(path: unknown): string {
  if (typeof path !== 'string' || !FOLDER_RE.test(path)) throw new HttpError(400, 'Nama folder tidak valid.');
  return path;
}

export function assertFile(path: unknown): string {
  if (typeof path !== 'string' || !FILE_RE.test(path)) throw new HttpError(400, 'Nama file tidak valid.');
  return path;
}

export function folderExists(entries: MediaEntry[], folder: string): boolean {
  return entries.some((e) => inFolder(e.path, folder));
}

/**
 * Files referenced from src/, read from the deployed /admin/media-usage.json.
 * Fails open: the build-time check in that same endpoint still stops a deploy
 * that points at a deleted file.
 */
export async function usedFiles(ctx: APIContext): Promise<Set<string>> {
  try {
    const res = await fetch(new URL('/admin/media-usage.json', ctx.url), { cache: 'no-store' });
    if (!res.ok) return new Set();
    return new Set(Object.keys((await res.json()).used ?? {}));
  } catch {
    return new Set();
  }
}

export function assertUnused(paths: string[], used: Set<string>): void {
  const busy = paths.filter((p) => used.has(p));
  if (busy.length)
    throw new HttpError(
      409,
      `Tidak bisa diubah karena sedang dipakai di website: ${busy.map((p) => `/media/${p}`).join(', ')}. Minta developer melepasnya dulu.`,
    );
}
