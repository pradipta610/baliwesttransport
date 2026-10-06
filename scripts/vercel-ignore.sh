#!/bin/sh
# Vercel "Ignored Build Step": exit 0 = skip the build, exit 1 = build.
# Any other exit code marks the deployment as Error, so this script only ever
# returns 0 or 1, and falls back to building whenever something is unclear.
#
# Skips commits that only touch public/media/ — the owner's uploads from
# /admin/media/. Those files go live with the next code deploy.

prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$prev" ] || exit 1

# Vercel's clone is shallow; fetch the last deployed commit if it isn't there.
if ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=1 origin "$prev" 2>/dev/null || exit 1
fi

if git diff --quiet "$prev" HEAD -- . ':(exclude)public/media' 2>/dev/null; then
  echo "Only public/media changed since $prev — skipping build."
  exit 0
fi
exit 1
