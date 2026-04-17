#!/usr/bin/env bash
# One-shot Supabase setup for Weimar Crisis / Secret Hitler.
#
# PREREQS (do these first):
#   1. Create a Supabase project at https://supabase.com/dashboard/new
#      (name it, pick a region, set a DB password — remember the password)
#   2. Have `supabase` CLI installed: `brew install supabase/tap/supabase`
#   3. Run `supabase login` (opens browser, one-time)
#
# Then run this script from the repo root:
#   bash supabase/setup.sh <project-ref>
#
# project-ref is the slug in your project URL — e.g. if your project URL is
# https://abcdefghij.supabase.co, the ref is `abcdefghij`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ $# -lt 1 ]; then
  echo "Usage: bash supabase/setup.sh <project-ref>"
  echo "Find your ref at https://supabase.com/dashboard/project/_/settings/general"
  exit 1
fi

PROJECT_REF="$1"

command -v supabase >/dev/null || { echo "supabase CLI not found. brew install supabase/tap/supabase"; exit 1; }

echo "==> Linking Supabase project $PROJECT_REF..."
# `link` will prompt for the DB password interactively if needed
supabase link --project-ref "$PROJECT_REF"

echo "==> Applying SQL schema..."
# Run setup.sql via the linked project's DB
supabase db execute --file supabase/setup.sql || {
  echo "    (db execute failed — trying fallback via psql)"
  # Fallback: prompt-driven psql via supabase connection string
  supabase db push --file supabase/setup.sql
}

echo "==> Deploying Edge Function 'sh'..."
supabase functions deploy sh --no-verify-jwt

echo "==> Fetching project URL and anon key..."
# Project URL pattern:
PROJECT_URL="https://${PROJECT_REF}.supabase.co"
# Anon key via CLI:
ANON_KEY="$(supabase projects api-keys --project-ref "$PROJECT_REF" --output json 2>/dev/null \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); print(next(k["api_key"] for k in data if k["name"]=="anon"))' 2>/dev/null || true)"

if [ -z "$ANON_KEY" ]; then
  echo "    (CLI key fetch didn't work. Paste your ANON key manually:)"
  read -r -p "Anon key: " ANON_KEY
fi

echo "==> Patching index.html..."
# BSD sed on macOS requires -i ''
sed -i '' "s|const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';|const SUPABASE_URL = '${PROJECT_URL}';|" index.html
sed -i '' "s|const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';|const SUPABASE_ANON_KEY = '${ANON_KEY}';|" index.html

echo ""
echo "✅ Supabase setup complete."
echo "   Project URL:  $PROJECT_URL"
echo "   Function URL: $PROJECT_URL/functions/v1/sh"
echo ""
echo "Next: push to GitHub Pages. Run:"
echo "   bash supabase/github-pages.sh"
