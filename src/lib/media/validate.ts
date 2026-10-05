import { FILE_RE, IMAGE, VIDEO } from './config';
import { HttpError } from './server';

// Guard 2: the server never trusts the browser's compression. Every file is
// checked by its actual bytes, not its name or the content-type header.

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** Top-level MP4 boxes in file order. */
function mp4Boxes(b: Uint8Array): Array<{ type: string; start: number; end: number }> {
  const boxes = [];
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (size === 1) size = Number((BigInt(u32be(b, i + 8)) << 32n) + BigInt(u32be(b, i + 12)));
    else if (size === 0) size = b.length - i;
    if (size < 8) break;
    boxes.push({ type, start: i, end: Math.min(i + size, b.length) });
    i += size;
  }
  return boxes;
}

function includesAscii(b: Uint8Array, start: number, end: number, needle: string): boolean {
  const n = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = start; i <= end - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function validateMedia(path: string, b: Uint8Array): void {
  if (!FILE_RE.test(path)) throw new HttpError(400, `Nama file tidak valid: ${path}`);

  if (path.endsWith('.webp')) {
    const dim = webpSize(b);
    if (!dim) throw new HttpError(400, `${path} bukan file WebP yang valid.`);
    if (b.length > IMAGE.serverMaxBytes) throw new HttpError(400, `${path} terlalu besar (${mb(b.length)}). Foto belum terkompres.`);
    if (Math.max(dim.width, dim.height) > IMAGE.serverMaxEdge)
      throw new HttpError(400, `${path} terlalu besar (${dim.width}×${dim.height}px). Maksimal ${IMAGE.serverMaxEdge}px.`);
    return;
  }

  const boxes = mp4Boxes(b);
  if (boxes[0]?.type !== 'ftyp') throw new HttpError(400, `${path} bukan file MP4 yang valid.`);
  if (b.length > VIDEO.serverMaxBytes) throw new HttpError(400, `${path} terlalu besar (${mb(b.length)}). Maksimal ${mb(VIDEO.serverMaxBytes)}.`);
  const moov = boxes.findIndex((x) => x.type === 'moov');
  const mdat = boxes.findIndex((x) => x.type === 'mdat');
  if (moov === -1) throw new HttpError(400, `${path} rusak (tidak ada metadata video).`);
  // moov before mdat = "fast start": the browser can begin playing before the whole file downloads.
  if (mdat !== -1 && mdat < moov) throw new HttpError(400, `${path} belum dioptimasi untuk web (bukan fast-start).`);
  if (!includesAscii(b, boxes[moov].start, boxes[moov].end, 'avc1'))
    throw new HttpError(400, `${path} harus H.264 supaya bisa diputar di semua browser.`);
}
