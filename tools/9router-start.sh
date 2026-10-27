#!/usr/bin/env bash
# Khởi động 9router ở chế độ nền, KHÔNG đụng tới OmniRoute (127.0.0.1:20128).
# 9router chạy trên 127.0.0.1:20129, dữ liệu để trong workspace (9router-data/),
# không dùng ~/.9router để tránh lẫn với cấu hình khác.
#
# Dùng:  bash tools/9router-start.sh            # khởi động
#        bash tools/9router-start.sh --stop     # dừng
#        bash tools/9router-start.sh --status   # xem trạng thái
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/9router-app"
DATA="${NINEROUTER_DATA:-$ROOT/9router-data}"
PORT="${NINEROUTER_PORT:-20129}"
HOST=127.0.0.1
LOG="$DATA/logs/9router-server.log"
PIDFILE="$DATA/9router.pid"

stop_server() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      kill -9 "$pid" 2>/dev/null || true
      echo "Đã dừng 9router (pid $pid)."
    fi
    rm -f "$PIDFILE"
  else
    # Không có pidfile: chỉ dừng tiến trình khớp ĐÚNG đường dẫn cli.js của 9router này,
    # không dùng pattern chung để tránh kill nhầm tiến trình khác.
    if pkill -f "$APP/node_modules/9router/cli.js" 2>/dev/null; then
      echo "Đã dừng 9router (theo đường dẫn cli.js, không có pidfile)."
    else
      echo "Không thấy pidfile và không thấy tiến trình 9router — có thể chưa chạy."
    fi
  fi
}

status_server() {
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    echo "9router ĐANG CHẠY tại http://$HOST:$PORT"
  else
    echo "9router KHÔNG chạy (port $PORT trống)."
  fi
  echo -n "OmniRoute 20128: "
  if ss -tln 2>/dev/null | grep -q ":20128 "; then echo "vẫn sống (không bị ảnh hưởng)"; else echo "không thấy"; fi
}

case "${1:-start}" in
  --stop) stop_server; exit 0 ;;
  --status) status_server; exit 0 ;;
esac

if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  echo "Port $PORT đã có tiến trình lắng nghe — không khởi động trùng."
  status_server
  exit 0
fi

[[ -x "$APP/node_modules/.bin/9router" ]] || {
  echo "Thiếu $APP/node_modules/.bin/9router — cài lại: npm install --prefix \"$APP\" 9router" >&2
  exit 1
}

mkdir -p "$DATA/logs"
export DATA_DIR="$DATA"
setsid nohup node "$APP/node_modules/9router/cli.js" \
  --port "$PORT" --host "$HOST" --no-browser --skip-update --log \
  > "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

for _ in $(seq 1 60); do
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    echo "9router đã lên: http://$HOST:$PORT/dashboard  (pid $(cat "$PIDFILE"), log $LOG)"
    exit 0
  fi
  sleep 0.5
done

echo "9router KHÔNG lên sau 30s. 30 dòng cuối log:" >&2
tail -30 "$LOG" >&2
exit 1
