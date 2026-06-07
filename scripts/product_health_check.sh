#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

run cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
run pnpm test
run pnpm eval:rag
run cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture --test-threads=1
run pnpm build
run pnpm secret-scan

if [[ "${PRODUCT_HEALTH_BUILD_TAURI:-0}" == "1" ]]; then
  run pnpm tauri build --debug --bundles app
  app_binary="src-tauri/target/debug/bundle/macos/框选精读.app/Contents/MacOS/focused-reading"
  if [[ ! -x "$app_binary" ]]; then
    echo "Expected app binary missing: $app_binary" >&2
    exit 1
  fi
  run "$app_binary" --product-self-check
else
  printf '\n==> skipping Tauri app bundle; set PRODUCT_HEALTH_BUILD_TAURI=1 to build the debug .app\n'
fi

printf '\nProduct health check passed.\n'
