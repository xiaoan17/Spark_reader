#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

patterns='(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[0-9A-Za-z_]{20,}|glpat-[0-9A-Za-z_-]{20,}|hf_[0-9A-Za-z]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY)'

files="$(mktemp)"
matches="$(mktemp)"
trap 'rm -f "$files" "$matches"' EXIT

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # quotePath off so non-ASCII filenames arrive raw (quoted paths made rg skip
  # them entirely); drop tracked-but-deleted entries so rg has real files.
  git -c core.quotePath=false ls-files -co --exclude-standard \
    | while IFS= read -r file; do [ -f "$file" ] && printf '%s\n' "$file"; done >"$files"
else
  tmp_git="$(mktemp -d)"
  git --git-dir="$tmp_git/gitdir" --work-tree=. init -q
  GIT_DIR="$tmp_git/gitdir" GIT_WORK_TREE=. git -c core.quotePath=false add -N . >/dev/null 2>&1
  GIT_DIR="$tmp_git/gitdir" GIT_WORK_TREE=. git -c core.quotePath=false ls-files -co --exclude-standard >"$files"
  rm -rf "$tmp_git"
fi

if [ ! -s "$files" ]; then
  echo "No candidate files to scan."
  exit 0
fi

if xargs -0 rg --pcre2 -i --files-with-matches "$patterns" < <(tr '\n' '\0' <"$files") >"$matches"; then
  echo "Potential secret-related matches found in:"
  sed 's/^/  /' "$matches"
  echo
  echo "Review these files before committing. Secret values are intentionally not printed."
  exit 1
fi

echo "Secret scan passed."
