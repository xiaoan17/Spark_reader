#!/usr/bin/env bash
# 安全发布 macOS DMG:本地构建 → 校验产物无密钥泄露 → 生成 SHA-256 校验和。
# 当前策略:adhoc 签名(无 Apple 证书),仅 arm64。用户安装需绕过 Gatekeeper(见 release notes)。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> [1/5] 推送前密钥扫描"
bash scripts/secret_scan.sh

echo "==> [2/5] 构建前端 + Tauri (arm64, adhoc 签名)"
# Tauri 默认对本机架构 adhoc 签名;不注入任何 Apple 证书环境变量。
pnpm tauri build --target aarch64-apple-darwin

bundle_dir="src-tauri/target/aarch64-apple-darwin/release/bundle"
dmg_dir="$bundle_dir/dmg"
app_dir="$bundle_dir/macos"

dmg_path="$(find "$dmg_dir" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -1)"
app_path="$(find "$app_dir" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)"

if [ -z "$dmg_path" ]; then
  echo "✗ 未找到 DMG 产物,构建可能失败。" >&2
  exit 1
fi

echo "==> [3/5] 校验打包产物未混入密钥/敏感文件"
leak=0
# 3a. app bundle 里不应有 .env / key / 运行时设置
if [ -n "$app_path" ]; then
  if find "$app_path" \( -name '.env*' -o -name '*.key' -o -name '*.pem' -o -name 'llm-settings.json' \) | grep -q .; then
    echo "✗ app bundle 内发现敏感文件!" >&2
    find "$app_path" \( -name '.env*' -o -name '*.key' -o -name '*.pem' -o -name 'llm-settings.json' \) >&2
    leak=1
  fi
  # 3b. 主二进制不应硬编码密钥串
  bin="$(find "$app_path/Contents/MacOS" -type f -perm +111 | head -1)"
  if [ -n "$bin" ] && strings "$bin" 2>/dev/null | grep -qE 'sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.'; then
    echo "✗ 二进制内疑似硬编码密钥!" >&2
    leak=1
  fi
fi
if [ "$leak" -ne 0 ]; then
  echo "✗ 安全校验未通过,已中止发布。" >&2
  exit 1
fi
echo "    ✓ 产物干净,无密钥泄露"

echo "==> [4/5] 验证签名状态"
codesign -dv "$app_path" 2>&1 | grep -E 'Signature|Identifier' || true

echo "==> [5/5] 生成 SHA-256 校验和"
out_dir="releases/dmg-$(/bin/date +%Y%m%d-%H%M%S 2>/dev/null || echo manual)"
mkdir -p "$out_dir"
cp "$dmg_path" "$out_dir/"
dmg_name="$(basename "$dmg_path")"
( cd "$out_dir" && shasum -a 256 "$dmg_name" | tee "$dmg_name.sha256" )

echo ""
echo "✅ 完成。产物在: $out_dir"
echo "   - $dmg_name"
echo "   - $dmg_name.sha256  (随 release 一起上传,供用户校验)"
echo ""
echo "下一步:把 DMG + .sha256 上传到 GitHub Release,并附上 RELEASE_NOTES 里的安装说明。"
