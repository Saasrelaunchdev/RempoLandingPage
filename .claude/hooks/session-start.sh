#!/bin/bash
# Runs at the start of every Claude Code session on this repository (see CLAUDE.md, "One branch: main").
#
# 1. Brings this session's branch up to date with origin/main, so no session starts from an old copy of the site.
# 2. Lists every branch on GitHub that holds work main does not have, so that work is merged, not silently dropped.
# 3. Installs the root npm dependencies (for `npm test`), only when package.json or the lockfile changed.
#
# Never blocks the session: a failed fetch or merge is reported, not fatal. Safe to run by hand at any time:
#   .claude/hooks/session-start.sh
set -uo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO" || exit 0

# Which event started the hook (startup, resume, clear, compact). Sync on startup and resume only, so a long task is not
# changed under Claude's feet after a /clear or a compaction. Run by hand (no input): sync.
source="manual"
if [ ! -t 0 ]; then
  input="$(cat 2>/dev/null || true)"
  s="$(printf '%s' "$input" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' | head -1)"
  [ -n "$s" ] && source="$s"
fi

echo "== Branch sync (CLAUDE.md: main is the one branch; every session starts from it and ends merged into it)"

if [ "$source" = "clear" ] || [ "$source" = "compact" ]; then
  echo "Skipped on '$source'. Before you push, run: git fetch origin main && git merge origin/main"
else
  if ! timeout 60 git fetch --quiet --prune origin 2>/dev/null; then
    echo "WARNING: could not fetch from GitHub. Fetch origin/main yourself before you change anything."
  fi

  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  if ! git rev-parse --verify --quiet origin/main >/dev/null; then
    echo "WARNING: origin/main not found. Fetch it before you change anything."
  elif [ "$branch" = "HEAD" ]; then
    echo "WARNING: detached HEAD. Check out your session branch, then merge origin/main into it."
  elif [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "WARNING: '$branch' has uncommitted changes, so it was not synced. Commit them, then: git merge origin/main"
  elif git merge-base --is-ancestor origin/main HEAD; then
    echo "OK: '$branch' already has everything on main ($(git rev-parse --short origin/main))."
  elif git merge-base --is-ancestor HEAD origin/main; then
    if git merge --quiet --ff-only origin/main 2>/dev/null; then
      echo "OK: '$branch' fast-forwarded to main ($(git rev-parse --short origin/main))."
    else
      echo "WARNING: could not fast-forward '$branch' to origin/main. Do it before you change anything."
    fi
  else
    if git merge --quiet --no-edit origin/main >/dev/null 2>&1; then
      echo "OK: merged main ($(git rev-parse --short origin/main)) into '$branch'. Run the tests before you continue."
    else
      git merge --abort >/dev/null 2>&1 || true
      echo "STOP: merging main into '$branch' conflicts. Merge origin/main yourself and resolve it by CLAUDE.md's"
      echo "      rules (keep both sides; rebuild generated pages from their sources) before any new work."
    fi
  fi

  # Work on GitHub that main does not have. Each line is a change the owner may believe is live but is not on main.
  unmerged=""
  while read -r ref; do
    [ "$ref" = "origin/main" ] || [ "$ref" = "origin/HEAD" ] || [ "$ref" = "origin/$branch" ] && continue
    n="$(git rev-list --count "origin/main..$ref" 2>/dev/null || echo 0)"
    if [ "$n" -gt 0 ]; then
      last="$(git log -1 --format='%cr: %s' "$ref" 2>/dev/null)"
      unmerged="${unmerged}  - ${ref#origin/} ($n commit(s) not on main; last ${last})"$'\n'
    fi
  done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin/)
  if [ -n "$unmerged" ]; then
    echo "STOP: these branches hold work that is NOT on main. If it was ever previewed or promoted, the owner may think"
    echo "      it is live. Tell the owner, and merge it into main (CLAUDE.md, step 1) before starting new work:"
    printf '%s' "$unmerged"
  else
    echo "OK: no other branch holds work that main lacks."
  fi
fi

# Root dependencies for `npm test`, only when what decides them changed since the last successful install.
hashes=node_modules/.session-start.sha256
if [ -f package-lock.json ] && command -v npm >/dev/null && ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  if npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1; then
    sha256sum package.json package-lock.json > "$hashes" 2>/dev/null || rm -f "$hashes"
    echo "OK: npm dependencies installed."
  else
    echo "WARNING: npm install failed; run it before npm test."
  fi
fi

exit 0
