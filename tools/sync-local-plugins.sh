#!/usr/bin/env bash
# Đồng bộ 3 plugin cục bộ trong workspace với bản DSH đang thực sự nạp.
#
# VẤN ĐỀ NÓ GIẢI QUYẾT
# Ba plugin dưới đây được cài vào profile bằng đường dẫn file: (không phải gói npm):
#     dsh-decide, dsh-vibe-guard, dsh-loop-guard
# pnpm KHÔNG symlink mà COPY nội dung thư mục vào
#     ~/.dsh/profiles/web/node_modules/<tên-plugin>
# và giữ bản copy đó trong cache của nó. Hệ quả: bạn sửa code trong workspace,
# chạy `dsh plugin --profile web add file:...` (hoặc `install --force`) — bản đang
# cài VẪN là code cũ. Nghĩa là bản sửa của bạn không có tác dụng, DSH vẫn chạy
# code cũ, mà không có cảnh báo nào. (Đã xảy ra thật với dsh-loop-guard và
# dsh-vibe-guard trong phiên 2026-10-08.)
#
# CÁCH SỬA
# Thay thư mục copy bằng một symlink trỏ về workspace. Từ đó sửa file trong
# workspace = sửa luôn bản DSH nạp (chỉ cần restart DSH để nạp lại code).
#
# CÁCH DÙNG
#     bash tools/sync-local-plugins.sh          # chỉ kiểm tra, không sửa gì
#     bash tools/sync-local-plugins.sh --fix    # tạo lại symlink nếu cần
#
# Nhớ chạy lại script này SAU MỖI lần `pnpm install` / cài plugin, vì pnpm có
# thể ghi đè symlink bằng bản copy cũ trở lại.

set -uo pipefail

PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS=(dsh-decide dsh-vibe-guard dsh-loop-guard)
FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }

if [ ! -d "$PROFILE" ]; then
  echo "$(red 'LỖI'): không tìm thấy profile web tại $PROFILE"
  exit 1
fi

echo "Profile: $PROFILE"
echo "Workspace: $WS"
echo "Chế độ: $([ "$FIX" = 1 ] && echo 'SỬA (--fix)' || echo 'chỉ kiểm tra')"
echo

FAILS=0
FIXED=0
for p in "${PLUGINS[@]}"; do
  src="$WS/$p"
  dst="$PROFILE/node_modules/$p"
  printf '%-17s ' "$p"

  if [ ! -d "$src" ]; then
    echo "$(yellow 'BỎ QUA')  không có thư mục nguồn $src"
    continue
  fi

  # Trạng thái hiện tại
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ] \
     && diff -rq --exclude=node_modules --exclude=.git "$dst" "$src" >/dev/null 2>&1; then
    echo "$(green 'OK')      symlink đúng, nội dung khớp workspace"
    continue
  fi

  if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "$(red 'CHƯA CÀI')"
    echo "             → chạy: dsh plugin --profile web add file:$src"
    FAILS=$((FAILS+1))
    continue
  fi

  if [ -L "$dst" ]; then
    echo "$(red 'SAI ĐÍCH') symlink trỏ tới $(readlink "$dst")"
  elif diff -rq --exclude=node_modules --exclude=.git "$dst" "$src" >/dev/null 2>&1; then
    echo "$(yellow 'BẢN SAO')  nội dung còn khớp, nhưng KHÔNG phải symlink"
    echo "             (lần sau sửa code sẽ không có tác dụng — nên --fix ngay)"
  else
    echo "$(red 'DRIFT')    bản copy CŨ, khác workspace ⇒ code sửa KHÔNG có tác dụng"
  fi
  FAILS=$((FAILS+1))

  if [ "$FIX" = 1 ]; then
    bak="/tmp/${p}-installed-$(date +%s)"
    if cp -r "$dst" "$bak" 2>/dev/null; then
      rm -rf "$dst" && ln -s "$src" "$dst"
      if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
        echo "             $(green 'ĐÃ SỬA') → symlink mới; bản cũ lưu ở $bak"
        FAILS=$((FAILS-1)); FIXED=$((FIXED+1))
      else
        echo "             $(red 'SỬA THẤT BẠI') — làm tay: rm -rf '$dst' && ln -s '$src' '$dst'"
      fi
    else
      echo "             $(red 'SỬA THẤT BẠI') — không sao lưu được $dst (còn tiến trình đang dùng?)"
    fi
  else
    echo "             → sửa: bash tools/sync-local-plugins.sh --fix"
  fi
done

echo
if [ "$FIXED" -gt 0 ]; then
  echo "$(green "Đã sửa $FIXED plugin.") Kiểm tra lại để chắc chắn:"
  echo
  exec bash "${BASH_SOURCE[0]}"
fi
if [ "$FAILS" -eq 0 ]; then
  echo "$(green 'Tất cả plugin cục bộ đều đồng bộ với workspace.')"
  echo "Nhắc: restart DSH thì code mới (nếu vừa sửa) mới được nạp."
  exit 0
fi

echo "$(red "$FAILS plugin cần xử lý.")"
exit 1
