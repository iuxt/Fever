#!/bin/bash
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本仅支持 macOS。" >&2
  exit 1
fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "请先安装 Node.js 24 和 npm。" >&2
  exit 1
fi

case "$(node -p 'process.arch')" in
  arm64) arch=arm64; app_subdir=mac-arm64 ;;
  x64) arch=x64; app_subdir=mac ;;
  *) echo "不支持的 Mac 架构。" >&2; exit 1 ;;
esac

app_path=/Applications/Fever.app
process_pattern='[F]ever\.app/Contents/MacOS/Fever([[:space:]]|$)'
build_dir=''
install_dir=''
use_sudo=false

if [[ ! -w /Applications ]]; then
  echo "安装到 /Applications 需要管理员权限。"
  sudo -v
  use_sudo=true
fi

install_command() {
  if [[ "$use_sudo" == true ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$install_dir" ]]; then
    # 新应用尚未安装成功时，恢复原来的应用。
    if [[ ! -e "$app_path" && -d "$install_dir/previous.app" ]]; then
      install_command mv "$install_dir/previous.app" "$app_path" || true
    fi
    # 恢复失败时保留备份，避免删除唯一的旧应用。
    if [[ ! -d "$install_dir/previous.app" || -d "$app_path" ]]; then
      install_command rm -rf "$install_dir" || true
    else
      echo "旧应用备份保留在：$install_dir/previous.app" >&2
    fi
  fi
  if [[ -n "$build_dir" ]]; then
    rm -rf "$build_dir" || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stop_app() {
  local pids attempt
  pids="$(pgrep -f "$process_pattern" || true)"
  [[ -n "$pids" ]] || return 0

  echo "正在停止旧的 Fever…"
  # 只匹配 Fever.app 的主进程，避免影响其他 Electron 应用。
  kill -TERM $pids 2>/dev/null || true
  for ((attempt = 0; attempt < 10; attempt++)); do
    pgrep -f "$process_pattern" >/dev/null || return 0
    sleep 1
  done

  echo "Fever 未在 10 秒内退出，正在强制停止…"
  pids="$(pgrep -f "$process_pattern" || true)"
  if [[ -n "$pids" ]]; then
    kill -KILL $pids 2>/dev/null || true
  fi
  for ((attempt = 0; attempt < 5; attempt++)); do
    pgrep -f "$process_pattern" >/dev/null || return 0
    sleep 1
  done
  echo "无法停止 Fever，已取消安装。" >&2
  return 1
}

stop_app

if [[ ! -x node_modules/.bin/electron-builder || ! -x node_modules/.bin/vite || ! -x node_modules/.bin/tsc || ! -f node_modules/electron/install.js ]]; then
  echo "正在安装项目依赖…"
  npm ci
fi

# Electron 44 起按需下载二进制，npm ci 不会生成 electronDist。
# 安装器会复用已安装且版本匹配的运行时，缺失时才下载。
echo "正在准备 Electron 运行时…"
ELECTRON_INSTALL_PLATFORM=darwin ELECTRON_INSTALL_ARCH="$arch" node node_modules/electron/install.js
if [[ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ]]; then
  echo "Electron 运行时未正确安装，已取消构建。" >&2
  exit 1
fi

build_dir="$(mktemp -d "${TMPDIR:-/tmp}/Fever-build.XXXXXX")"
echo "正在构建 Fever   $arch   …"
npm run build
node_modules/.bin/electron-builder --mac --dir "--$arch" --publish never \
  --config.directories.output="$build_dir" \
  --config.electronDist="$PWD/node_modules/electron/dist"

built_app="$build_dir/$app_subdir/Fever.app"
if [[ ! -x "$built_app/Contents/MacOS/Fever" ]]; then
  echo "构建未生成可用的 Fever.app，已取消安装。" >&2
  exit 1
fi

echo "正在安装到 $app_path  …"
install_dir="$(install_command mktemp -d /Applications/.Fever-install.XXXXXX)"
install_command chmod 755 "$install_dir"
install_command ditto "$built_app" "$install_dir/Fever.app"
# 构建期间用户可能重新打开了旧应用，替换前再检查一次。
stop_app
if [[ -e "$app_path" || -L "$app_path" ]]; then
  install_command mv "$app_path" "$install_dir/previous.app"
fi
install_command mv "$install_dir/Fever.app" "$app_path"

echo "正在启动 Fever…"
open "$app_path"
echo "完成：$app_path"
