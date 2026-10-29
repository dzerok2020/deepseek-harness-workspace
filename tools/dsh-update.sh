#!/usr/bin/env bash
# Cập nhật DeepSeek Harness CLI + profile web lên 0.2.1-rc.2
#
# CHẠY TỪ TERMINAL THƯỜNG (không chạy trong phiên DSH): thao tác ghi nằm ngoài
# workspace nên sandbox của phiên AI chặn.
#
#   bash tools/dsh-update.sh            # cập nhật
#   bash tools/dsh-update.sh --rollback # khôi phục bản backup gần nhất
#
set -euo pipefail

NEW_VERSION="0.2.1-rc.2"
PROFILE_BASE_VERSION="0.2.0-rc.2"
PROFILE_DIR="$HOME/.dsh/profiles/web"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/.dsh/backups/dsh-update-$STAMP"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nLỖI: %s\n' "$*" >&2; exit 1; }

valid_cli_version() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; }

apply_managed_overload_patch() {
  local global_root target patch_file
  command -v patch >/dev/null || die "thiếu patch; không thể bảo toàn managed overload fix"
  patch_file="$SCRIPT_DIR/dsh-pi-ai-overload.patch"
  [[ -f "$patch_file" ]] || die "thiếu managed overload patch: $patch_file"
  global_root="$(npm root -g)"
  [[ "$global_root" == /* ]] || die "npm root -g không trả đường dẫn tuyệt đối"
  target="$global_root/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai"
  [[ -f "$target/lib/index.js" ]] || die "không thấy dsh-llm-pi-ai đã cài: $target"
  if patch --batch --forward --dry-run --fuzz=0 -p1 -d "$target" < "$patch_file" >/dev/null 2>&1; then
    patch --batch --forward --fuzz=0 -p1 -d "$target" < "$patch_file" \
      || die "không áp dụng được managed overload patch"
  elif patch --batch --reverse --dry-run --fuzz=0 -p1 -d "$target" < "$patch_file" >/dev/null 2>&1; then
    echo "Managed overload patch đã có; không áp dụng trùng."
  else
    die "dsh-llm-pi-ai source drift: managed overload patch không khớp chính xác; KHÔNG restart"
  fi
}

# ---------------------------------------------------------------- rollback ---
if [[ "${1:-}" == "--rollback" ]]; then
  # `|| true`: nếu không có backup, pipeline trả non-zero và set -e/pipefail sẽ
  # làm script thoát im lặng ở đây, khiến die() bên dưới không bao giờ chạy.
  LAST="$(ls -1dt "$HOME"/.dsh/backups/dsh-update-* 2>/dev/null | head -1 || true)"
  [[ -n "$LAST" ]] || die "không tìm thấy backup nào trong ~/.dsh/backups/dsh-update-*"
  [[ -f "$LAST/cli-version" ]] || die "backup thiếu CLI provenance (cli-version); không đoán bản rollback"
  ROLLBACK_VERSION="$(cat "$LAST/cli-version")"
  valid_cli_version "$ROLLBACK_VERSION" || die "CLI provenance không hợp lệ trong backup"
  for file in package.json pnpm-workspace.yaml pnpm-lock.yaml cordis.patch.yml; do
    [[ -f "$LAST/$file" ]] || die "backup thiếu $file; không rollback một phần"
  done
  say "Khôi phục từ $LAST (CLI $ROLLBACK_VERSION)"
  npm install -g "@deepseek-ai/dsh@$ROLLBACK_VERSION"
  apply_managed_overload_patch
  cp "$LAST/package.json" "$PROFILE_DIR/package.json"
  cp "$LAST/pnpm-workspace.yaml" "$PROFILE_DIR/pnpm-workspace.yaml"
  cp "$LAST/pnpm-lock.yaml" "$PROFILE_DIR/pnpm-lock.yaml"
  cp "$LAST/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"
  ( cd "$PROFILE_DIR" && pnpm install )
  say "Xong. Restart dsh web rồi kiểm tra: dsh --version"
  exit 0
fi

# --------------------------------------------------------------- 0. kiểm tra --
say "0. Kiểm tra hiện trạng"
command -v dsh   >/dev/null || die "không thấy lệnh dsh trong PATH"
command -v pnpm  >/dev/null || die "không thấy pnpm trong PATH"
CURRENT="$(dsh --version 2>&1 | tr -d '[:space:]')"
valid_cli_version "$CURRENT" || die "không xác định được CLI version để backup an toàn"
echo "dsh đang cài : $CURRENT"
echo "sẽ nâng lên  : $NEW_VERSION"
[[ "$CURRENT" == "$NEW_VERSION" ]] && { echo "Đã là bản mới nhất, không cần làm gì."; exit 0; }

# Cảnh báo nếu dsh web đang chạy
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:3080'; then
  echo
  echo "CẢNH BÁO: có tiến trình đang nghe cổng 3080 (dsh web đang chạy)."
  echo "Hãy thoát GUI/tiến trình đó trước khi cập nhật."
  read -r -p "Tiếp tục? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Đã huỷ."; exit 1; }
fi

# ---------------------------------------------------------------- 1. backup --
say "1. Backup vào $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp "$PROFILE_DIR/package.json"      "$BACKUP_DIR/"
cp "$PROFILE_DIR/pnpm-workspace.yaml" "$BACKUP_DIR/"
cp "$PROFILE_DIR/pnpm-lock.yaml"    "$BACKUP_DIR/"
cp "$PROFILE_DIR/cordis.patch.yml"  "$BACKUP_DIR/"
printf '%s\n' "$CURRENT" > "$BACKUP_DIR/cli-version"
echo "Đã sao lưu 4 file cấu hình profile."

# --------------------------------------------------------- 2. CLI toàn cục --
say "2. Cập nhật CLI toàn cục"
npm install -g "@deepseek-ai/dsh@$NEW_VERSION"
apply_managed_overload_patch

# ------------------------------------------------------------- 3. profile ---
# Override trong pnpm-workspace.yaml phải đổi theo: agent-useful-skills yêu cầu
# ^0.1.1-rc.1, mà semver prerelease KHÔNG khớp 0.2.x — bỏ override là pnpm nest
# bản cũ và tạo đúng lỗi "hai bản host package" đã ghi trong chính file đó.
say "3. Đổi override dsh-skill-filesystem: $PROFILE_BASE_VERSION -> $NEW_VERSION"
sed -i "s/'@deepseek-ai\/dsh-skill-filesystem': $PROFILE_BASE_VERSION/'@deepseek-ai\/dsh-skill-filesystem': $NEW_VERSION/" \
  "$PROFILE_DIR/pnpm-workspace.yaml"
sed -i "s|\"@deepseek-ai/dsh-skill-filesystem\": \"$PROFILE_BASE_VERSION\"|\"@deepseek-ai/dsh-skill-filesystem\": \"$NEW_VERSION\"|" \
  "$PROFILE_DIR/package.json"

grep -q "$NEW_VERSION" "$PROFILE_DIR/pnpm-workspace.yaml" \
  || die "sed không đổi được override — kiểm tra lại pnpm-workspace.yaml bằng tay"

say "4. Cài lại dependency của profile"
( cd "$PROFILE_DIR" && pnpm install )

# ------------------------------------------------------------- 5. kiểm tra --
say "5. Kiểm tra kết quả"
NEWCLI="$(dsh --version 2>&1 | tr -d '[:space:]')"
echo "dsh CLI        : $NEWCLI"
echo "skill-filesystem trong profile:"
# pnpm list có thể fail (vd profile chưa cài xong); không được để `|| true`
  # nuốt luôn lỗi thật, nên tách: lỗi của pnpm đi ra stderr, chỉ lọc phần hiển thị.
  ( cd "$PROFILE_DIR" && pnpm list "@deepseek-ai/dsh-skill-filesystem" --depth 0 ) \
    | grep -i filesystem || echo "(không liệt kê được — dùng số đếm ở dòng dưới)"

COUNT="$(find "$PROFILE_DIR/node_modules" -path '*@deepseek-ai/dsh-skill-filesystem/package.json' 2>/dev/null | wc -l)"
echo "số bản dsh-skill-filesystem đã cài: $COUNT (mong đợi 1)"
[[ "$COUNT" == "1" ]] || die "phát hiện $COUNT bản trùng — KHÔNG restart vội, xem lại override"

[[ "$NEWCLI" == "$NEW_VERSION" ]] || die "CLI vẫn là $NEWCLI"

cat <<EOF

--------------------------------------------------------------
XONG. Bước cuối do bạn làm:

  1) Restart dsh web (thoát tiến trình cũ rồi chạy lại như thường lệ).
  2) Chạy kiểm tra sức khoẻ toàn hệ:
       bash tools/dsh-health.sh
  3) Nếu có trục trặc, khôi phục:
       bash tools/dsh-update.sh --rollback

Backup nằm ở: $BACKUP_DIR
--------------------------------------------------------------
EOF