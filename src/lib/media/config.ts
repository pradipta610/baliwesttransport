// Shared by the browser uploader (guard 1) and the API (guard 2). The client
// compresses to the TARGET values; the server rejects anything above the MAX
// values, so an uncompressed file can never reach the repo even if the
// browser step is bypassed.

export const MEDIA_ROOT = 'public/media';
export const MEDIA_URL_PREFIX = '/media';

export const IMAGE = {
  maxEdge: 1920, // long edge, px — covers full-width heroes on desktop
  quality: 0.82, // WebP starting quality, stepped down until targetBytes is met
  minQuality: 0.6,
  targetBytes: 350 * 1024,
  serverMaxEdge: 2048,
  serverMaxBytes: 600 * 1024,
} as const;

export const VIDEO = {
  maxEdge: 1280, // 720p — matches what the site's video blocks display at
  videoBitrate: 1_600_000,
  minVideoBitrate: 600_000,
  audioBitrate: 96_000,
  targetBytes: 18 * 1024 * 1024,
  serverMaxBytes: 20 * 1024 * 1024, // jsDelivr preview + GitHub stay comfortable below this
  maxInputBytes: 1024 * 1024 * 1024,
} as const;

export const POSTER = { maxEdge: 1280, quality: 0.78 } as const;

// Vercel caps a function request body at 4.5 MB, so uploads are sent in raw chunks below that.
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_FILES_PER_COMMIT = 40;
export const MAX_FOLDER_DEPTH = 3;

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';
export const SEGMENT_RE = new RegExp(`^${SEGMENT}$`);
export const FOLDER_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,${MAX_FOLDER_DEPTH - 1}}$`);
export const FILE_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,${MAX_FOLDER_DEPTH - 1}}/${SEGMENT}\\.(webp|mp4)$`);

/** "Foto Armada Innova (1).JPG" -> "foto-armada-innova-1" */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}
