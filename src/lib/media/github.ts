import { MEDIA_ROOT } from './config';
import { env, HttpError } from './server';

// The media library lives in the repo itself (public/media/**), so every
// change made from /admin/media/ is a normal git commit the dev team pulls.

const API = 'https://api.github.com';

function repo() {
  const name = process.env.GITHUB_REPO ?? import.meta.env.GITHUB_REPO ?? 'pradipta610/baliwesttransport';
  const branch = process.env.GITHUB_BRANCH ?? import.meta.env.GITHUB_BRANCH ?? 'main';
  return { name, branch };
}

async function gh(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const res = await fetch(`${API}/repos/${repo().name}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env('GITHUB_TOKEN')}`,
      accept: init.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`GitHub ${init.method ?? 'GET'} ${path} -> ${res.status}: ${detail.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Token GitHub tidak valid atau tidak punya akses tulis.');
    if (res.status === 422 && detail.includes('fast forward')) throw new RefConflict();
    throw new HttpError(502, `GitHub menolak permintaan (${res.status}).`);
  }
  return res;
}

class RefConflict extends Error {}

export interface MediaEntry {
  /** Path relative to public/media, e.g. "armada/innova-reborn.webp" or "armada/.gitkeep" */
  path: string;
  sha: string;
  size: number;
}

export interface MediaSnapshot {
  commit: string;
  entries: MediaEntry[];
}

async function head(): Promise<{ commit: string; tree: string }> {
  const ref = await (await gh(`/git/ref/heads/${repo().branch}`)).json();
  const commit = await (await gh(`/git/commits/${ref.object.sha}`)).json();
  return { commit: ref.object.sha, tree: commit.tree.sha };
}

async function mediaEntries(treeSha: string): Promise<MediaEntry[]> {
  const tree = await (await gh(`/git/trees/${treeSha}?recursive=1`)).json();
  if (tree.truncated) throw new HttpError(502, 'Repo terlalu besar untuk dibaca sekaligus.');
  const prefix = `${MEDIA_ROOT}/`;
  return (tree.tree as Array<{ path: string; type: string; sha: string; size?: number }>)
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
    .map((e) => ({ path: e.path.slice(prefix.length), sha: e.sha, size: e.size ?? 0 }));
}

export async function snapshot(): Promise<MediaSnapshot> {
  const h = await head();
  return { commit: h.commit, entries: await mediaEntries(h.tree) };
}

export async function createBlob(bytes: Uint8Array): Promise<string> {
  const res = await gh('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }),
  });
  return (await res.json()).sha;
}

let emptySha: string | undefined;
export async function emptyBlob(): Promise<string> {
  return (emptySha ??= await createBlob(new Uint8Array()));
}

export async function readBlob(sha: string): Promise<Uint8Array> {
  const res = await gh(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw' });
  return new Uint8Array(await res.arrayBuffer());
}

/** path relative to public/media; sha null deletes the file. */
export interface Change {
  path: string;
  sha: string | null;
}

/**
 * Commits a set of changes on top of the branch head. `plan` receives the
 * current media entries so renames/deletes are computed against fresh state;
 * it is re-run if someone else pushed in the meantime.
 */
export async function commitChanges(message: string, plan: (entries: MediaEntry[]) => Change[]): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const h = await head();
    const changes = plan(await mediaEntries(h.tree));
    if (changes.length === 0) return h.commit;

    const tree = await (
      await gh('/git/trees', {
        method: 'POST',
        body: JSON.stringify({
          base_tree: h.tree,
          tree: changes.map((c) => ({ path: `${MEDIA_ROOT}/${c.path}`, mode: '100644', type: 'blob', sha: c.sha })),
        }),
      })
    ).json();
    const commit = await (
      await gh('/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message: `media: ${message}`, tree: tree.sha, parents: [h.commit] }),
      })
    ).json();
    try {
      await gh(`/git/refs/heads/${repo().branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      return commit.sha;
    } catch (err) {
      if (!(err instanceof RefConflict)) throw err;
    }
  }
  throw new HttpError(409, 'Repo sedang sibuk diperbarui. Coba lagi sebentar.');
}

/** Public CDN URL for previews — repo is public, and a commit-pinned URL never serves stale content. */
export function previewBase(commit: string): string {
  return `https://cdn.jsdelivr.net/gh/${repo().name}@${commit}/${MEDIA_ROOT}`;
}
