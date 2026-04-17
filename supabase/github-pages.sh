#!/usr/bin/env bash
# Publish the repo to GitHub Pages.
# Assumes you're already inside the repo and `gh` CLI is authed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v gh >/dev/null || { echo "gh CLI not found. brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authed. Run: gh auth login"; exit 1; }

# Ensure git initialized
if [ ! -d .git ]; then
  git init
  git checkout -b main
fi

# Create or use existing remote
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "==> Creating GitHub repo..."
  read -r -p "Repo name (public): " REPO_NAME
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
else
  echo "==> Origin already set ($(git remote get-url origin))"
fi

# Commit any pending changes
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git commit -m "Deploy Weimar Crisis + Secret Hitler (Supabase)" || true
  git push -u origin main
fi

# Enable Pages from main / root
REPO_FULL="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "==> Enabling Pages for $REPO_FULL..."
gh api -X POST "repos/$REPO_FULL/pages" \
  -F "source[branch]=main" \
  -F "source[path]=/" 2>/dev/null || \
  gh api -X PUT "repos/$REPO_FULL/pages" \
    -F "source[branch]=main" \
    -F "source[path]=/" 2>/dev/null || true

OWNER="$(echo "$REPO_FULL" | cut -d/ -f1)"
NAME="$(echo "$REPO_FULL" | cut -d/ -f2)"
echo ""
echo "✅ Pushed. Pages will be live in ~1 minute at:"
echo "   https://$OWNER.github.io/$NAME/"
