import { CHUNK_BYTES, MAX_FILES_PER_COMMIT, MEDIA_URL_PREFIX, slugify } from '../lib/media/config';
import { compressImage, compressVideo, kindOf, type Compressed } from '../lib/media/compress';

interface MediaFile {
  path: string;
  size: number;
}

const state = {
  previewBase: '',
  folders: [] as string[],
  files: [] as MediaFile[],
  used: {} as Record<string, string[]>,
  current: '',
  selected: new Set<string>(),
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const isPoster = (path: string) => path.endsWith('-poster.webp') && state.files.some((f) => f.path === path.replace(/-poster\.webp$/, '.mp4'));
const posterFor = (path: string) => {
  const p = path.replace(/\.mp4$/, '-poster.webp');
  return state.files.some((f) => f.path === p) ? p : null;
};

// ------------------------------------------------------------------ api

class Unauthorized extends Error {}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  // trailing slash: the site runs with trailingSlash 'always', and a redirected POST loses its body
  const res = await fetch(`/api/media/${path}/`, {
    ...init,
    headers: init.body && !(init.body instanceof Blob) ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    showLogin();
    throw new Unauthorized(data.error);
  }
  if (!res.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
  return data;
}

const post = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

// ------------------------------------------------------------------ ui helpers

function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const el = document.createElement('div');
  el.className = `px-4 py-3 text-sm shadow-lg ${kind === 'error' ? 'bg-red-700 text-white' : 'bg-brand-dark text-brand-cream'}`;
  el.textContent = message;
  $('toast').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 3500);
}

function fail(err: unknown) {
  if (err instanceof Unauthorized) return;
  toast(err instanceof Error ? err.message : String(err), 'error');
}

/** Resolves to the typed value (input mode), '' (confirm mode) or null if cancelled. */
function ask(opts: { title: string; text?: string; value?: string; ok: string; slug?: boolean; danger?: boolean }): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('dialog');
  const input = $<HTMLInputElement>('dialog-input');
  const hint = $('dialog-hint');
  $('dialog-title').textContent = opts.title;
  $('dialog-text').textContent = opts.text ?? '';
  $('dialog-ok').textContent = opts.ok;
  $('dialog-ok').className = `${opts.danger ? 'bg-red-700' : 'bg-brand-gold'} text-white px-5 py-2 text-sm font-medium hover:bg-brand-dark`;
  const hasInput = opts.value !== undefined;
  input.hidden = hint.hidden = !hasInput;
  input.value = opts.value ?? '';
  const updateHint = () => {
    hint.textContent = opts.slug ? `Disimpan sebagai: ${slugify(input.value) || '—'}` : '';
  };
  input.oninput = updateHint;
  updateHint();
  dialog.returnValue = '';
  dialog.showModal();
  if (hasInput) input.select();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'ok' ? (hasInput ? (opts.slug ? slugify(input.value) : input.value.trim()) : '') : null),
      { once: true },
    );
  });
}

async function copy(text: string, label: string) {
  await navigator.clipboard.writeText(text);
  toast(`${label} disalin`);
}

// ------------------------------------------------------------------ views

function showLogin() {
  $('loading').classList.add('hidden');
  $('app-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('password').focus();
}

async function load(folder = state.current) {
  const [list, usage] = await Promise.all([
    api<{ previewBase: string; folders: string[]; files: MediaFile[] }>('list'),
    fetch('/admin/media-usage.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { used: {} }))
      .catch(() => ({ used: {} })),
  ]);
  Object.assign(state, list, { used: usage.used ?? {} });
  state.current = state.folders.includes(folder) ? folder : (state.folders[0] ?? '');
  state.selected.clear();
  $('loading').classList.add('hidden');
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  render();
}

function openFolder(folder: string) {
  state.current = folder;
  state.selected.clear();
  history.replaceState(null, '', `#${folder}`);
  render();
}

function render() {
  renderTree();
  const hasFolders = state.folders.length > 0;
  $('empty-state').classList.toggle('hidden', hasFolders);
  $('folder-view').classList.toggle('hidden', !hasFolders);
  if (hasFolders) renderFolder();
}

function renderTree() {
  $('folder-tree').innerHTML = state.folders
    .map((f) => {
      const depth = f.split('/').length - 1;
      const count = state.files.filter((x) => parentOf(x.path) === f && !isPoster(x.path)).length;
      const active = f === state.current;
      return `<button data-folder="${esc(f)}" style="padding-left:${0.75 + depth}rem"
        class="w-full text-left pr-3 py-2 flex items-center justify-between gap-2 ${active ? 'bg-brand-dark text-brand-cream' : 'hover:bg-brand-cream'}">
        <span class="truncate">${depth ? '└ ' : ''}${esc(nameOf(f))}</span>
        <span class="text-xs ${active ? 'text-brand-gold' : 'text-brand-dark/50'}">${count}</span>
      </button>`;
    })
    .join('');
}

function renderFolder() {
  const folder = state.current;
  const parts = folder.split('/');
  $('breadcrumb').innerHTML = ['media', ...parts]
    .map((p, i) =>
      i === 0 || i === parts.length
        ? `<span>${esc(p)}</span>`
        : `<button data-folder="${esc(parts.slice(0, i).join('/'))}" class="hover:text-brand-gold underline">${esc(p)}</button>`,
    )
    .join('<span>/</span>');
  $('folder-title').textContent = nameOf(folder);
  $('new-subfolder').hidden = parts.length >= 3;

  const subfolders = state.folders.filter((f) => parentOf(f) === folder);
  $('subfolders').innerHTML = subfolders
    .map(
      (f) => `<button data-folder="${esc(f)}" class="bg-white p-4 text-left text-sm hover:shadow-md transition-shadow flex items-center gap-2">
        <svg class="w-5 h-5 text-brand-gold shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
        <span class="truncate text-brand-dark">${esc(nameOf(f))}</span></button>`,
    )
    .join('');

  const files = state.files.filter((f) => parentOf(f.path) === folder && !isPoster(f.path));
  $('folder-empty').classList.toggle('hidden', files.length > 0 || subfolders.length > 0);
  $('files').innerHTML = files.map(fileCard).join('');
  renderSelection();
}

function fileCard(f: MediaFile): string {
  const url = `${state.previewBase}/${f.path}`;
  const isVideo = f.path.endsWith('.mp4');
  const poster = isVideo ? posterFor(f.path) : null;
  const usedIn = state.used[f.path] ?? [];
  const checked = state.selected.has(f.path);
  const media = isVideo
    ? `<video src="${esc(url)}" ${poster ? `poster="${esc(`${state.previewBase}/${poster}`)}"` : ''} preload="none" controls playsinline class="w-full h-full object-cover bg-brand-dark"></video>`
    : `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" data-dims="${esc(f.path)}">`;
  return `<article class="bg-white group relative" data-file="${esc(f.path)}">
    <div class="aspect-[4/3] bg-brand-cream overflow-hidden">${media}</div>
    ${usedIn.length ? '' : `<label class="absolute top-2 left-2 bg-white/90 p-1.5 cursor-pointer ${checked ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}"><input type="checkbox" data-select="${esc(f.path)}" ${checked ? 'checked' : ''} aria-label="Pilih ${esc(nameOf(f.path))}"></label>`}
    ${usedIn.length ? `<span title="${esc(usedIn.join('\n'))}" class="absolute top-2 right-2 bg-brand-gold text-white text-xs px-2 py-1">Dipakai di website</span>` : ''}
    <div class="p-3">
      <p class="text-sm text-brand-dark break-all leading-snug">${esc(nameOf(f.path))}</p>
      <p class="text-xs text-brand-dark/60 mt-1"><span>${size(f.size)}</span><span data-dims-label="${esc(f.path)}"></span>${isVideo ? ' · video' : ''}</p>
      <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
        <button data-copy-path="${esc(f.path)}" class="text-brand-gold hover:text-brand-dark font-medium">Salin path</button>
        <button data-copy-code="${esc(f.path)}" class="text-brand-dark/70 hover:text-brand-gold">Salin kode</button>
        ${usedIn.length ? '' : `<button data-rename="${esc(f.path)}" class="text-brand-dark/70 hover:text-brand-gold">Ganti nama</button>
        <button data-delete="${esc(f.path)}" class="text-red-700 hover:text-red-900">Hapus</button>`}
      </div>
    </div>
  </article>`;
}

function renderSelection() {
  const n = state.selected.size;
  $('selection-bar').classList.toggle('hidden', n === 0);
  $('selection-count').textContent = `${n} file dipilih`;
}

// ------------------------------------------------------------------ actions

async function newFolder(parent: string) {
  const name = await ask({
    title: parent ? `Subfolder di ${nameOf(parent)}` : 'Folder baru',
    text: 'Pakai nama layanan atau topik supaya gampang dicari, misalnya “gilimanuk-to-ubud” atau “armada”.',
    value: '',
    ok: 'Buat folder',
    slug: true,
  });
  if (!name) return;
  const path = parent ? `${parent}/${name}` : name;
  try {
    await post('folder', { action: 'create', path });
    await load(path);
    openFolder(path);
    toast(`Folder ${path} dibuat`);
  } catch (err) {
    fail(err);
  }
}

async function renameFolder() {
  const from = state.current;
  const name = await ask({ title: 'Ganti nama folder', value: nameOf(from), ok: 'Simpan', slug: true });
  if (!name || name === nameOf(from)) return;
  const to = parentOf(from) ? `${parentOf(from)}/${name}` : name;
  try {
    await post('folder', { action: 'rename', path: from, to });
    await load(to);
    openFolder(to);
    toast('Nama folder diganti');
  } catch (err) {
    fail(err);
  }
}

async function deleteFolder() {
  const path = state.current;
  const count = state.files.filter((f) => f.path.startsWith(`${path}/`)).length;
  const ok = await ask({
    title: `Hapus folder ${nameOf(path)}?`,
    text: count ? `${count} file di dalamnya (termasuk subfolder) ikut terhapus.` : 'Folder ini kosong.',
    ok: 'Hapus',
    danger: true,
  });
  if (ok === null) return;
  try {
    await post('folder', { action: 'delete', path });
    await load(parentOf(path));
    toast('Folder dihapus');
  } catch (err) {
    fail(err);
  }
}

async function deleteFiles(paths: string[]) {
  const ok = await ask({
    title: paths.length === 1 ? `Hapus ${nameOf(paths[0])}?` : `Hapus ${paths.length} file?`,
    text: 'File yang dihapus tidak bisa dikembalikan dari halaman ini.',
    ok: 'Hapus',
    danger: true,
  });
  if (ok === null) return;
  try {
    await post('file', { action: 'delete', paths });
    await load();
    toast('File dihapus');
  } catch (err) {
    fail(err);
  }
}

async function renameFile(path: string) {
  const ext = path.slice(path.lastIndexOf('.'));
  const name = await ask({ title: 'Ganti nama file', value: nameOf(path).slice(0, -ext.length), ok: 'Simpan', slug: true });
  if (!name || `${name}${ext}` === nameOf(path)) return;
  try {
    await post('file', { action: 'move', path, to: `${parentOf(path)}/${name}${ext}` });
    await load();
    toast('Nama file diganti');
  } catch (err) {
    fail(err);
  }
}

function snippet(path: string): string {
  const src = `${MEDIA_URL_PREFIX}/${path}`;
  if (path.endsWith('.mp4')) {
    const poster = posterFor(path);
    return `<video src="${src}"${poster ? ` poster="${MEDIA_URL_PREFIX}/${poster}"` : ''} muted loop playsinline preload="metadata"></video>`;
  }
  const img = document.querySelector<HTMLImageElement>(`img[data-dims="${CSS.escape(path)}"]`);
  const dims = img?.naturalWidth ? ` width="${img.naturalWidth}" height="${img.naturalHeight}"` : '';
  return `<img src="${src}" alt=""${dims} loading="lazy" decoding="async" />`;
}

// ------------------------------------------------------------------ upload

let uploading = Promise.resolve();
let busy = 0;

function queueRow(file: File) {
  const queue = $('upload-queue');
  queue.classList.remove('hidden');
  const row = document.createElement('div');
  row.className = 'text-sm';
  row.innerHTML = `<div class="flex justify-between gap-3"><span class="truncate text-brand-dark"></span><span class="shrink-0 text-brand-dark/60" data-status></span></div>
    <div class="h-1 bg-brand-cream mt-1.5"><div class="h-full bg-brand-gold transition-all" style="width:0%" data-bar></div></div>`;
  row.querySelector('span')!.textContent = file.name;
  queue.prepend(row);
  const status = row.querySelector<HTMLElement>('[data-status]')!;
  const bar = row.querySelector<HTMLElement>('[data-bar]')!;
  return {
    set(text: string, fraction?: number) {
      status.textContent = text;
      if (fraction !== undefined) bar.style.width = `${Math.round(fraction * 100)}%`;
    },
    error(text: string) {
      status.textContent = text;
      status.className = 'shrink-0 text-red-700 text-right';
      bar.className = 'h-full bg-red-700';
      bar.style.width = '100%';
    },
    done(text: string) {
      status.textContent = text;
      status.className = 'shrink-0 text-green-700';
      bar.style.width = '100%';
    },
  };
}

function uniqueName(base: string, ext: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(`${name}.${ext}`) || (ext === 'mp4' && taken.has(`${name}-poster.webp`)); i++) name = `${base}-${i}`;
  taken.add(`${name}.${ext}`);
  if (ext === 'mp4') taken.add(`${name}-poster.webp`);
  return name;
}

async function sendChunks(blob: Blob): Promise<string[]> {
  const shas: string[] = [];
  for (let start = 0; start < blob.size; start += CHUNK_BYTES) {
    const part = blob.slice(start, start + CHUNK_BYTES);
    for (let attempt = 1; ; attempt++) {
      try {
        shas.push((await api<{ sha: string }>('chunk', { method: 'POST', body: part })).sha);
        break;
      } catch (err) {
        if (attempt >= 3 || err instanceof Unauthorized) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  return shas;
}

async function uploadBatch(list: File[], folder: string) {
  const taken = new Set(state.files.filter((f) => parentOf(f.path) === folder).map((f) => nameOf(f.path)));
  // One entry per source file; a video and its poster stay together so they land in the same commit.
  const ready: Array<{ files: Array<{ path: string; chunks: string[] }>; row: ReturnType<typeof queueRow>; summary: string }> = [];

  for (const file of list) {
    const row = queueRow(file);
    const kind = kindOf(file);
    if (!kind) {
      row.error('Bukan foto/video');
      continue;
    }
    try {
      row.set('Mengompres…', 0);
      const out: Compressed = await (kind === 'image' ? compressImage : compressVideo)(file, (p) =>
        row.set(`Mengompres ${Math.round(p * 100)}%`, p * 0.7),
      );
      const ext = kind === 'image' ? 'webp' : 'mp4';
      const name = uniqueName(slugify(file.name) || kind, ext, taken);
      row.set('Mengunggah…', 0.75);
      const files = [{ path: `${folder}/${name}.${ext}`, chunks: await sendChunks(out.blob) }];
      if (out.poster) files.push({ path: `${folder}/${name}-poster.webp`, chunks: await sendChunks(out.poster) });
      const summary = `${name}.${ext} · ${size(file.size)} → ${size(out.blob.size)}`;
      ready.push({ files, row, summary });
      row.set(`Menyimpan… ${summary}`, 0.9);
    } catch (err) {
      if (err instanceof Unauthorized) return;
      row.error(err instanceof Error ? err.message : 'Gagal');
    }
  }

  const groups: (typeof ready)[] = [];
  for (const item of ready) {
    const last = groups.at(-1);
    if (last && last.reduce((n, x) => n + x.files.length, 0) + item.files.length <= MAX_FILES_PER_COMMIT) last.push(item);
    else groups.push([item]);
  }
  for (const group of groups) {
    try {
      await post('commit', { files: group.flatMap((x) => x.files) });
      for (const item of group) item.row.done(`Tersimpan · ${item.summary}`);
    } catch (err) {
      for (const item of group) item.row.error(err instanceof Error ? err.message : 'Gagal menyimpan');
    }
  }
  if (ready.length) await load(folder).catch(fail);
}

function upload(list: FileList | File[]) {
  const files = [...list];
  const folder = state.current;
  if (!files.length || !folder) return;
  busy++;
  uploading = uploading.then(() => uploadBatch(files, folder)).catch(fail).finally(() => busy--);
}

// ------------------------------------------------------------------ events

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('login-error');
  error.classList.add('hidden');
  try {
    await post('login', { password: $<HTMLInputElement>('password').value });
    $<HTMLInputElement>('password').value = '';
    await load(decodeURIComponent(location.hash.slice(1)));
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : 'Gagal masuk';
    error.classList.remove('hidden');
  }
});

$('logout').addEventListener('click', async () => {
  await post('logout', {}).catch(() => {});
  showLogin();
});

$('new-root-folder').addEventListener('click', () => newFolder(''));
$('new-subfolder').addEventListener('click', () => newFolder(state.current));
$('rename-folder').addEventListener('click', renameFolder);
$('delete-folder').addEventListener('click', deleteFolder);
$('clear-selection').addEventListener('click', () => {
  state.selected.clear();
  renderFolder();
});
$('delete-selected').addEventListener('click', () => deleteFiles([...state.selected]));
$<HTMLInputElement>('file-input').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) upload(input.files);
  input.value = '';
});

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-folder],[data-action],[data-copy-path],[data-copy-code],[data-rename],[data-delete]',
  );
  if (!t) return;
  const d = t.dataset;
  if (d.folder !== undefined) openFolder(d.folder);
  else if (d.action === 'new-root-folder') newFolder('');
  else if (d.copyPath) copy(`${MEDIA_URL_PREFIX}/${d.copyPath}`, 'Path').catch(fail);
  else if (d.copyCode) copy(snippet(d.copyCode), 'Kode').catch(fail);
  else if (d.rename) renameFile(d.rename);
  else if (d.delete) deleteFiles([d.delete]);
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.dataset.select) return;
  if (t.checked) state.selected.add(t.dataset.select);
  else state.selected.delete(t.dataset.select);
  renderSelection();
});

// Show real pixel dimensions once each preview loads (load events don't bubble, so capture).
document.addEventListener(
  'load',
  (e) => {
    const img = e.target as HTMLImageElement;
    const label = img.dataset?.dims && document.querySelector(`[data-dims-label="${CSS.escape(img.dataset.dims)}"]`);
    if (label) label.textContent = ` · ${img.naturalWidth}×${img.naturalHeight}`;
  },
  true,
);

const zone = $('dropzone');
for (const type of ['dragenter', 'dragover'])
  document.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.add('border-brand-gold', 'bg-white');
  });
for (const type of ['dragleave', 'drop'])
  document.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.remove('border-brand-gold', 'bg-white');
  });
document.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files.length && !$('folder-view').classList.contains('hidden')) upload(e.dataTransfer.files);
});

window.addEventListener('beforeunload', (e) => {
  if (busy) e.preventDefault(); // upload still running — leaving would lose it
});

load(decodeURIComponent(location.hash.slice(1))).catch(fail);
