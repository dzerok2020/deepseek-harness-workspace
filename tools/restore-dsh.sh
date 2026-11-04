#!/usr/bin/env bash
# tools/restore-dsh.sh
# Khôi phục toàn bộ cấu hình, 34 plugin, 82+ skill, AGENTS.md và service của DeepSeek Harness (DSH)
# Dùng khi cài lại máy (Linux hoặc Windows WSL2) để khôi phục 100% chức năng như hiện tại.

set -euo pipefail

green()  { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red()    { printf '\033[31m%s\033[0m\n' "$1"; }
blue()   { printf '\033[34m%s\033[0m\n' "$1"; }

WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
BACKUP_DIR="$WS/dsh-backup"

echo "======================================================================"
blue "   KHÔI PHỤC DEEPSEEK HARNESS (DSH) TỪ WORKSPACE REPO"
echo "======================================================================"
echo "Workspace : $WS"
echo "DSH Home  : $DSH_HOME"
echo

# 1. Kiểm tra môi trường & công cụ thiết yếu
echo ">>> [1/7] Kiểm tra công cụ cần thiết..."
for cmd in git node pnpm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "LỖI: Chưa cài '$cmd'. Vui lòng cài đặt trước khi chạy script."
    exit 1
  fi
done
green "  ✓ Node: $(node -v), pnpm: $(pnpm -v), git: $(git --version | awk '{print $3}')"

if ! command -v dsh >/dev/null 2>&1; then
  yellow "  ⚠ 'dsh' chưa có trong PATH. Hãy cài bằng: npm i -g @deepseek-ai/dsh@0.2.1-rc.2"
fi

# 2. Tạo thư mục DSH
echo ">>> [2/7] Khởi tạo cấu trúc thư mục DSH..."
mkdir -p "$DSH_HOME" "$DSH_HOME/profiles/web" "$DSH_HOME/skills"
green "  ✓ Đã chuẩn bị thư mục $DSH_HOME"

# 3. Khôi phục global AGENTS.md & decide.json
echo ">>> [3/7] Khôi phục AGENTS.md toàn cục & cấu hình..."
cp "$BACKUP_DIR/AGENTS.md" "$DSH_HOME/AGENTS.md"
green "  ✓ Đã chép ~/.dsh/AGENTS.md (Karpathy, Tiếng Việt thô, Cinematic Spatial UI)"

if [ ! -f "$DSH_HOME/decide.json" ] && [ -f "$BACKUP_DIR/decide.json" ]; then
  cp "$BACKUP_DIR/decide.json" "$DSH_HOME/decide.json"
  green "  ✓ Đã tạo ~/.dsh/decide.json (mẫu)"
fi

if [ ! -f "$DSH_HOME/.credentials.yaml" ] && [ -f "$BACKUP_DIR/.credentials.yaml.example" ]; then
  cp "$BACKUP_DIR/.credentials.yaml.example" "$DSH_HOME/.credentials.yaml.example"
  green "  ✓ Đã đặt file mẫu ~/.dsh/.credentials.yaml.example"
fi

# 4. Khôi phục toàn bộ User Skills
echo ">>> [4/7] Khôi phục toàn bộ skills vào ~/.dsh/skills..."
if [ -d "$BACKUP_DIR/skills" ]; then
  cp -r "$BACKUP_DIR/skills/"* "$DSH_HOME/skills/"
  SKILL_COUNT=$(ls -1 "$DSH_HOME/skills" | wc -l)
  green "  ✓ Đã khôi phục $SKILL_COUNT skill vào ~/.dsh/skills"
fi

# 5. Khôi phục cấu hình profile `web` (package.json, pnpm-workspace.yaml, cordis.patch.yml)
echo ">>> [5/7] Khôi phục profile web và điều chỉnh đường dẫn theo máy mới..."
cp "$BACKUP_DIR/profiles/web/pnpm-workspace.yaml" "$DSH_HOME/profiles/web/pnpm-workspace.yaml"
if [ -f "$BACKUP_DIR/profiles/web/pnpm-lock.yaml" ]; then
  cp "$BACKUP_DIR/profiles/web/pnpm-lock.yaml" "$DSH_HOME/profiles/web/pnpm-lock.yaml"
fi

# Thay thế đường dẫn workspace cũ bằng đường dẫn workspace thực tế trên máy mới
node -e '
const fs = require("fs");
const path = require("path");
const ws = process.argv[1];
const targetPkgPath = path.join(process.argv[2], "package.json");
const sourcePkg = JSON.parse(fs.readFileSync(path.join(process.argv[3], "profiles/web/package.json"), "utf8"));

for (const [dep, ver] of Object.entries(sourcePkg.dependencies || {})) {
  if (typeof ver === "string" && (ver.startsWith("file:") || ver.startsWith("link:"))) {
    const pluginName = dep;
    const protocol = ver.startsWith("link:") ? "link:" : "file:";
    sourcePkg.dependencies[dep] = `${protocol}${path.join(ws, pluginName)}`;
  }
}
fs.writeFileSync(targetPkgPath, JSON.stringify(sourcePkg, null, 2) + "\n");
' "$WS" "$DSH_HOME/profiles/web" "$BACKUP_DIR"
green "  ✓ Đã đồng bộ ~/.dsh/profiles/web/package.json trỏ về $WS"

# Điều chỉnh cordis.patch.yml: thay thế đường dẫn home cũ bằng $HOME hiện tại
node -e '
const fs = require("fs");
const path = require("path");
const cordisSrc = fs.readFileSync(path.join(process.argv[2], "profiles/web/cordis.patch.yml"), "utf8");
const home = process.env.HOME;
const nodeBin = process.execPath;

// Thay thế đường dẫn home cũ
let updated = cordisSrc.replace(/\/home\/[a-zA-Z0-9._-]+/g, home);
// Đảm bảo node bin trỏ đúng node hiện tại nếu cần
if (fs.existsSync(nodeBin)) {
  updated = updated.replace(/command:\s*.*\/node/g, `command: ${nodeBin}`);
}
fs.writeFileSync(path.join(process.argv[1], "cordis.patch.yml"), updated);
' "$DSH_HOME/profiles/web" "$BACKUP_DIR"
green "  ✓ Đã tạo ~/.dsh/profiles/web/cordis.patch.yml thích ứng với $HOME"

# 6. Cài đặt các plugin npm & liên kết plugin cục bộ
echo ">>> [6/7] Cài đặt dependencies (pnpm install) và tạo symlink plugin cục bộ..."
(
  cd "$DSH_HOME/profiles/web"
  pnpm install --no-frozen-lockfile
)
green "  ✓ pnpm install hoàn tất"

bash "$WS/tools/sync-local-plugins.sh" --fix
green "  ✓ Đã symlink các plugin cục bộ (dsh-decide, dsh-vibe-guard, dsh-loop-guard, v.v.)"

# 7. Cấu hình systemd user units nếu có hỗ trợ
echo ">>> [7/7] Kiểm tra cấu hình systemd user services..."
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  mkdir -p "$HOME/.config/systemd/user"
  for unit in omniroute headroom-proxy hindsight-daemon hindsight-control-plane laya-serve; do
    if [ -f "$WS/systemd/$unit.service" ]; then
      ln -sf "$WS/systemd/$unit.service" "$HOME/.config/systemd/user/$unit.service"
    fi
  done
  systemctl --user daemon-reload 2>/dev/null || true
  green "  ✓ Đã liên kết các systemd user units từ $WS/systemd"
else
  yellow "  ℹ Hệ thống không chạy systemd trực tiếp (hoặc đang trong container). Bỏ qua bước bật service tự động."
fi

echo
echo "======================================================================"
green "   KHÔI PHỤC HOÀN TẤT! ĐANG CHẠY BỘ KIỂM TRA SỨC KHỎE..."
echo "======================================================================"
bash "$WS/tools/dsh-health.sh" || true

echo
blue "HƯỚNG DẪN TIẾP THEO:"
echo "1. Nếu cần API keys: cấu hình trong Web GUI Settings -> Providers hoặc export vào ~/.bashrc"
echo "2. Chạy DSH: dsh web"
echo "3. Kiểm tra bất cứ lúc nào bằng lệnh: bash tools/dsh-health.sh"
echo "======================================================================"
