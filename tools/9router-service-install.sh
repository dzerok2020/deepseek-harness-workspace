#!/usr/bin/env bash
# Cài/gỡ 9router như một systemd USER service (giống omniroute.service).
#
# VÌ SAO CẦN: tiến trình do lệnh bash của DSH khởi động bị dọn ngay khi lệnh kết thúc
# (bwrap --unshare-pid), nên chỉ chạy được kiểu "sống trong lúc lệnh đang chạy".
# Muốn 9router sống thường trực qua reboot → phải để systemd làm chủ.
#
# CHẠY Ở TERMINAL THẬT của bạn (không qua DSH), vì script cần ghi vào ~/.config/systemd/user.
#
# Dùng:
#   bash tools/9router-service-install.sh            # cài + bật + chạy
#   bash tools/9router-service-install.sh --status   # xem trạng thái
#   bash tools/9router-service-install.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$ROOT/tools/9router.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DIR/9router.service"
PORT=20129

need() { command -v "$1" >/dev/null 2>&1 || { echo "Thiếu lệnh: $1" >&2; exit 1; }; }
need systemctl

status_all() {
  systemctl --user --no-pager status 9router.service 2>/dev/null | head -12 || echo "9router.service chưa cài."
  echo "--- port ---"
  ss -tln 2>/dev/null | grep -E ":(20129|20128) " || echo "không thấy cổng nào trong (20129, 20128)"
  echo -n "HTTP 20129: "
  curl -sL -o /dev/null -w "%{http_code}\n" --max-time 5 "http://127.0.0.1:$PORT/" || true
  echo -n "HTTP 20128 (OmniRoute — phải vẫn sống): "
  curl -sL -o /dev/null -w "%{http_code}\n" --max-time 5 "http://127.0.0.1:20128/" || true
}

case "${1:-install}" in
  --status) status_all; exit 0 ;;
  --uninstall)
    systemctl --user disable --now 9router.service 2>/dev/null || true
    rm -f "$UNIT_DST"
    systemctl --user daemon-reload
    echo "Đã gỡ 9router.service (dữ liệu trong 9router-data/ vẫn còn)."
    exit 0
    ;;
esac

[[ -f "$UNIT_SRC" ]] || { echo "Không thấy unit mẫu: $UNIT_SRC" >&2; exit 1; }
[[ -d "$ROOT/9router-app/node_modules/9router" ]] || {
  echo "Chưa cài 9router trong workspace: $ROOT/9router-app" >&2
  echo "Cài trước: npm install --prefix 9router-app 9router" >&2
  exit 1
}

# 1. Chặn xung đột: nếu một tiến trình KHÁC đang giữ 20129 thì dừng lại, không giành port.
if ss -tln 2>/dev/null | grep -q ":$PORT " && ! systemctl --user is-active --quiet 9router.service 2>/dev/null; then
  echo "Port $PORT đang bị một tiến trình khác giữ. Dừng nó trước:" >&2
  echo "  ss -tlnp | grep ':$PORT '" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
systemctl --user daemon-reload
systemctl --user enable --now 9router.service

echo "Đã cài $UNIT_DST và bật 9router.service."
echo -n "Chờ cổng $PORT lên"
for _ in $(seq 1 40); do
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then echo " — OK."; break; fi
  echo -n "."; sleep 0.5
done

status_all
echo
echo "Nhật ký: journalctl --user -u 9router.service -f"
echo "Muốn chạy cả khi chưa đăng nhập (sau reboot không cần login): sudo loginctl enable-linger $USER"