// Guard 1 — runs in the owner's browser, so a 12 MB phone photo or a 200 MB
// video is shrunk before it ever leaves the device. Output always matches
// what the server (validate.ts) accepts: WebP images, H.264 fast-start MP4.

import { IMAGE, POSTER, VIDEO } from './config';

export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
  /** Extra file stored next to the video: a WebP frame for <video poster>. */
  poster?: Blob;
}

type Progress = (fraction: number) => void;

const HEIC_RE = /\.(heic|heif)$/i;

// ------------------------------------------------------------------ images

async function decodeImage(file: Blob, name: string): Promise<ImageBitmap> {
  try {
    // imageOrientation applies the EXIF rotation, so portrait phone photos stay upright.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!HEIC_RE.test(name) && !/hei[cf]/.test(file.type)) throw err;
    // Only Safari decodes HEIC natively; elsewhere convert iPhone photos to JPEG first.
    const { default: heic2any } = await import('heic2any');
    const jpeg = (await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 })) as Blob;
    return createImageBitmap(jpeg, { imageOrientation: 'from-image' });
  }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

let nativeWebp: boolean | undefined;

/** Canvas → WebP. Safari can't encode WebP from a canvas, so it falls back to a WASM encoder. */
async function toWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  if (nativeWebp !== false) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
    nativeWebp = blob?.type === 'image/webp';
    if (nativeWebp) return blob!;
  }
  const { default: encode } = await import('@jsquash/webp/encode');
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  return new Blob([await encode(data, { quality: Math.round(quality * 100) })], { type: 'image/webp' });
}

/** Resize to maxEdge, then lower quality (and if needed size) until the file fits targetBytes. */
async function encodeFitted(
  source: CanvasImageSource,
  w: number,
  h: number,
  maxEdge: number,
  startQuality: number,
  targetBytes: number = IMAGE.targetBytes,
) {
  let scale = Math.min(1, maxEdge / Math.max(w, h));
  for (;;) {
    const width = Math.round(w * scale);
    const height = Math.round(h * scale);
    const canvas = draw(source, width, height);
    let smallest: Blob | undefined;
    for (let q = startQuality; q >= IMAGE.minQuality - 1e-9; q -= 0.06) {
      const blob = await toWebp(canvas, q);
      if (blob.size <= targetBytes) return { blob, width, height };
      if (!smallest || blob.size < smallest.size) smallest = blob;
    }
    // Already-optimised source we couldn't undercut: keep the best-quality result that fits the normal budget.
    if (targetBytes < IMAGE.targetBytes && smallest && smallest.size <= IMAGE.targetBytes) return { blob: smallest, width, height };
    if (Math.max(width, height) <= 800) {
      const blob = await toWebp(canvas, IMAGE.minQuality);
      if (blob.size <= IMAGE.serverMaxBytes) return { blob, width, height };
      throw new Error('Foto terlalu detail untuk dikompres. Coba foto lain.');
    }
    scale *= 0.85;
  }
}

export async function compressImage(file: File, onProgress?: Progress): Promise<Compressed> {
  onProgress?.(0.1);
  const bitmap = await decodeImage(file, file.name);
  onProgress?.(0.4);
  try {
    // Never hand back a bigger file than the owner uploaded.
    const target = Math.min(IMAGE.targetBytes, file.size);
    return await encodeFitted(bitmap, bitmap.width, bitmap.height, IMAGE.maxEdge, IMAGE.quality, target);
  } finally {
    bitmap.close();
    onProgress?.(1);
  }
}

// ------------------------------------------------------------------ videos

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function compressVideo(file: File, onProgress?: Progress): Promise<Compressed> {
  if (file.size > VIDEO.maxInputBytes) throw new Error('Video lebih dari 1 GB. Potong dulu jadi lebih pendek.');

  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('File ini tidak berisi video.');
    const duration = await input.computeDuration();

    const scale = Math.min(1, VIDEO.maxEdge / Math.max(track.displayWidth, track.displayHeight));
    const width = even(track.displayWidth * scale);
    const height = even(track.displayHeight * scale);

    // Spread a fixed size budget over the clip length so long videos still land under the cap.
    const keepAudio = !!(await input.getPrimaryAudioTrack()) && (await mb.canEncodeAudio('aac', { bitrate: VIDEO.audioBitrate }));
    const budget = (VIDEO.targetBytes * 8) / Math.max(duration, 1) - (keepAudio ? VIDEO.audioBitrate : 0);
    if (budget < VIDEO.minVideoBitrate) {
      const maxSeconds = Math.floor((VIDEO.targetBytes * 8) / (VIDEO.minVideoBitrate + VIDEO.audioBitrate));
      throw new Error(`Video terlalu panjang (${Math.round(duration)} detik). Maksimal sekitar ${maxSeconds} detik — potong dulu.`);
    }
    // A source that's already lean (e.g. sent through WhatsApp) shouldn't come out bigger than it went in.
    const stats = await track.computePacketStats(120);
    const fps = stats.averagePacketRate;
    const sourceBitrate = stats.averageBitrate * ((width * height) / (track.displayWidth * track.displayHeight));
    const videoBitrate = Math.floor(Math.min(VIDEO.videoBitrate, budget, Math.max(VIDEO.minVideoBitrate, sourceBitrate * 0.9)));
    if (!(await mb.canEncodeVideo('avc', { width, height, bitrate: videoBitrate })))
      throw new Error('Browser ini belum bisa kompres video. Pakai Chrome, Edge, atau Safari versi terbaru.');

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        width,
        height,
        fit: 'fill',
        codec: 'avc',
        quality: new mb.Quality({ bitrate: videoBitrate }),
        frameRate: fps > 31 ? 30 : undefined, // 60fps phone clips double the size for no visible gain here
        allowTransformationMetadata: false, // bake rotation in so every player shows it upright
        forceTranscode: true,
      },
      audio: keepAudio
        ? { codec: 'aac', quality: new mb.Quality({ bitrate: VIDEO.audioBitrate }), numberOfChannels: 2, forceTranscode: true }
        : { discard: true },
    });
    if (!conversion.isValid) throw new Error('Format video ini tidak didukung. Coba export ulang sebagai MP4.');
    conversion.onProgress = (p) => onProgress?.(p * 0.9);
    await conversion.execute();

    const blob = new Blob([(output.target as InstanceType<typeof mb.BufferTarget>).buffer!], { type: 'video/mp4' });
    if (blob.size > VIDEO.serverMaxBytes) throw new Error('Hasil kompres masih terlalu besar. Potong videonya jadi lebih pendek.');

    // Poster frame from the original (sharper than the re-encoded one), a moment in to skip black intros.
    let poster: Blob | undefined;
    const pScale = Math.min(1, POSTER.maxEdge / Math.max(track.displayWidth, track.displayHeight));
    const pw = even(track.displayWidth * pScale);
    const ph = even(track.displayHeight * pScale);
    const frame = await new mb.CanvasSink(track, { width: pw, height: ph, fit: 'fill' }).getCanvas(Math.min(1, duration / 3));
    if (frame) poster = (await encodeFitted(frame.canvas, pw, ph, POSTER.maxEdge, POSTER.quality)).blob;

    onProgress?.(1);
    return { blob, width, height, poster };
  } finally {
    input.dispose();
  }
}

export function kindOf(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/') || HEIC_RE.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.name)) return 'video';
  return null;
}
