import { previewBase, snapshot } from '../../../lib/media/github';
import { folderOf, KEEP } from '../../../lib/media/library';
import { handler, json } from '../../../lib/media/server';

export const prerender = false;

export const GET = handler(async () => {
  const { commit, entries } = await snapshot();
  const folders = new Set<string>();
  for (const e of entries) {
    // register every ancestor so nested folders show up even without their own .gitkeep
    const parts = folderOf(e.path).split('/').filter(Boolean);
    parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
  }
  return json({
    commit,
    previewBase: previewBase(commit),
    folders: [...folders].sort(),
    files: entries.filter((e) => !e.path.endsWith(KEEP)).sort((a, b) => a.path.localeCompare(b.path)),
  });
});
