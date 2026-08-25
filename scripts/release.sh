#!/usr/bin/env bash
set -euo pipefail

# Independent release: publish only the @prism-analytics/* packages whose
# version changed (each package versions independently now).
# Usage:
#   node scripts/bump.mjs browser 0.0.2  # bump one
#   bash scripts/release.sh              # auto-detect changed + publish + tag
#   bash scripts/release.sh --all        # force publish all 5 (rare)
#
# Requires: npm login (as owner of @prism-analytics org), clean git tree, gh CLI for Release.

FORCE_ALL=false
if [[ "${1:-}" == "--all" ]]; then FORCE_ALL=true; fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in: run npm login first (as owner of @prism-analytics org)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree not clean — commit or stash first"
  git status --porcelain
  exit 1
fi

echo "Building..."
yarn build

PKGS=("@prism-analytics/core" "@prism-analytics/browser" "@prism-analytics/node" "@prism-analytics/react" "@prism-analytics/react-native")
TO_PUBLISH=()

for pkg in "${PKGS[@]}"; do
  dir=$(grep -l "\"name\": \"$pkg\"" packages/*/package.json | xargs dirname)
  local_ver=$(node -p "require('./$dir/package.json').version")
  npm_ver=$(npm view "$pkg" version 2>/dev/null || echo "0.0.0")
  if [[ "$FORCE_ALL" == true ]] || [[ "$local_ver" != "$npm_ver" ]]; then
    echo "  will publish $pkg $npm_ver -> $local_ver"
    TO_PUBLISH+=("$pkg|$dir|$local_ver")
  else
    echo "  skip $pkg@$local_ver (already on npm)"
  fi
done

if [[ ${#TO_PUBLISH[@]} -eq 0 ]]; then
  echo "Nothing to publish — bump a package first with: node scripts/bump.mjs <pkg> <version>"
  exit 0
fi

for entry in "${TO_PUBLISH[@]}"; do
  IFS='|' read -r pkg dir ver <<< "$entry"
  echo ""
  echo "Publishing $pkg@$ver from $dir ..."
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    npm publish --access public --provenance --workspace="$pkg"
  else
    npm publish --access public --workspace="$pkg"
  fi

  tag="$pkg@$ver"
  # npm scope tag like @prism-analytics/browser@0.0.2
  echo "Tagging $tag ..."
  git tag "$tag" -m "$tag" 2>/dev/null || echo "  tag $tag already exists, skipping"
done

git push origin --tags
git push origin main

if command -v gh >/dev/null 2>&1; then
  for entry in "${TO_PUBLISH[@]}"; do
    IFS='|' read -r pkg dir ver <<< "$entry"
    tag="$pkg@$ver"
    gh release create "$tag" --generate-notes --title "$tag" 2>/dev/null || echo "  release $tag already exists"
  done
  echo "GitHub Releases created — shows on repo sidebar per package"
else
  echo "gh CLI not found — create Releases manually at https://github.com/OrekuD/prism/releases/new"
fi

echo ""
echo "Done — published ${#TO_PUBLISH[@]} package(s)."
