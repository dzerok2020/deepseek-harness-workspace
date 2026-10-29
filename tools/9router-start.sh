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

process_guard() {
  python3 - "$1" "$APP" "$DATA" "$HOST" "$PORT" "${2:-}" <<'PY_PROCESS'
import json
import os
from pathlib import Path
import signal
import sys
import time

PROC = Path('/proc')


def snapshot(pid, tail, executable=None, server_dir=None):
    if type(pid) is not int or pid <= 1:
        raise RuntimeError('PID không hợp lệ')
    directory = PROC / str(pid)
    fields = (directory / 'stat').read_text().rsplit(') ', 1)[1].split()
    if fields[0] == 'Z':
        raise ProcessLookupError('process đã thoát')
    argv = [os.fsdecode(arg) for arg in (directory / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')]
    exe = str((directory / 'exe').resolve(strict=True))
    uid = directory.stat().st_uid
    valid_argv = bool(argv) and Path(argv[0]).name in ('node', 'nodejs') and argv[1:] == tail
    if not valid_argv and server_dir is not None:
        # Next replaces argv with its title. Accept ONLY the installed version's
        # exact title + real app cwd, still requiring Node/UID/parent/listener.
        manifest = json.loads((server_dir / 'node_modules/next/package.json').read_text())
        version = manifest.get('version') if isinstance(manifest, dict) else None
        valid_argv = (isinstance(version, str) and argv == ['next-server (v' + version + ')'] and
                      (directory / 'cwd').resolve(strict=True) == server_dir.resolve())
    if (uid != os.getuid() or Path(exe).name not in ('node', 'nodejs') or not valid_argv or
            (executable is not None and exe != executable)):
        raise RuntimeError('owner/exe/argv không khớp Node 9router đích')
    return {'pid': pid, 'start': fields[19], 'uid': uid, 'exe': exe}, int(fields[1])


def owns_listener(pid, port):
    directory = PROC / str(pid)
    sockets = {os.readlink(fd) for fd in (directory / 'fd').iterdir()}
    address = '0100007F:' + format(port, '04X')
    for line in (directory / 'net/tcp').read_text().splitlines()[1:]:
        fields = line.split()
        if (len(fields) > 9 and fields[1] == address and fields[3] == '0A' and
                'socket:[' + fields[9] + ']' in sockets):
            return True
    return False


def find_listener(controller, app, port):
    children = (PROC / str(controller['pid']) / 'task' / str(controller['pid']) / 'children').read_text().split()
    matches = []
    for child in children:
        for server in ('custom-server.js', 'server.js'):
            tail = ['--dns-result-order=ipv4first', '--max-old-space-size=6144',
                    str(app / 'node_modules/9router/app' / server)]
            try:
                identity, parent = snapshot(int(child), tail, controller['exe'], app / 'node_modules/9router/app')
                if parent == controller['pid'] and owns_listener(identity['pid'], port):
                    matches.append((identity, tail))
                    break
            except (OSError, RuntimeError, ValueError, IndexError):
                continue
    if len(matches) != 1:
        raise RuntimeError('không xác minh được duy nhất Node con sở hữu listener đích')
    return matches[0]


def main():
    mode, app, data, host, port, launch_pid = sys.argv[1:]
    app, pidfile, port = Path(app).resolve(), Path(data) / '9router.pid', int(port)
    if host != '127.0.0.1' or not 1 <= port <= 65535:
        raise RuntimeError('listener đích không hợp lệ')
    if mode == 'stop' and not pidfile.exists():
        print('Không có identity pidfile — không signal theo pattern/path.')
        return 0
    if not callable(getattr(os, 'pidfd_open', None)) or not callable(getattr(signal, 'pidfd_send_signal', None)):
        raise RuntimeError('cần Python/Linux pidfd; không dùng numeric PID kill fallback')
    cli_tail = [str(app / 'node_modules/9router/cli.js'), '--port', str(port), '--host', host,
                '--no-browser', '--skip-update', '--log']
    if mode == 'record':
        controller, _ = snapshot(int(launch_pid), cli_tail)
        find_listener(controller, app, port)
        temporary = pidfile.with_suffix('.pid.tmp')
        temporary.write_text(json.dumps(controller) + '\n')
        temporary.replace(pidfile)
        return 0
    if mode != 'stop':
        raise RuntimeError('mode không hợp lệ')
    controller = json.loads(pidfile.read_text())
    if (not isinstance(controller, dict) or set(controller) != {'pid', 'start', 'uid', 'exe'} or
            not isinstance(controller['start'], str) or not controller['start'].isdigit() or
            controller != snapshot(controller['pid'], cli_tail)[0]):
        raise RuntimeError('pidfile cũ/identity không khớp — giữ nguyên, KHÔNG signal')
    listener, server_tail = find_listener(controller, app, port)
    server_dir = app / 'node_modules/9router/app'
    pinned = []
    try:
        for identity in (controller, listener):
            pinned.append(os.pidfd_open(identity['pid'], 0))
        # pidfds pin generations; re-read identities after opening BOTH handles.
        if (snapshot(controller['pid'], cli_tail)[0] != controller or
                snapshot(listener['pid'], server_tail, controller['exe'], server_dir) != (listener, controller['pid']) or
                not owns_listener(listener['pid'], port)):
            raise RuntimeError('identity/listener đổi trong lúc pin PID — KHÔNG signal')
        # cli.js SIGTERM cleanup itself kills PID files/process groups. Never run
        # that unsafe handler: stop only this pinned supervisor, then its listener.
        signal.pidfd_send_signal(pinned[0], signal.SIGKILL)
        if (snapshot(listener['pid'], server_tail, controller['exe'], server_dir)[0] != listener or
                not owns_listener(listener['pid'], port)):
            raise RuntimeError('listener đổi trước TERM — không signal')
        signal.pidfd_send_signal(pinned[1], signal.SIGTERM)
        for _ in range(20):
            time.sleep(0.25)
            try:
                if snapshot(listener['pid'], server_tail, controller['exe'], server_dir)[0] != listener:
                    raise RuntimeError('listener identity đổi sau TERM — không KILL')
            except (FileNotFoundError, ProcessLookupError):
                break
        else:
            if not owns_listener(listener['pid'], port):
                raise RuntimeError('listener đã đóng socket — không KILL process khác')
            signal.pidfd_send_signal(pinned[1], signal.SIGKILL)
        pidfile.unlink()
        print('Đã dừng đúng supervisor/listener 9router bằng pidfd.')
        return 0
    finally:
        for descriptor in pinned:
            os.close(descriptor)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError, IndexError, TypeError) as error:
        print('Từ chối signal 9router: ' + str(error), file=sys.stderr)
        sys.exit(1)
PY_PROCESS
}

stop_server() {
  process_guard stop
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

command -v python3 >/dev/null || { echo "Cần python3 để quản lý PID an toàn." >&2; exit 1; }
mkdir -p "$DATA/logs"
export DATA_DIR="$DATA"
setsid nohup node "$APP/node_modules/9router/cli.js" \
  --port "$PORT" --host "$HOST" --no-browser --skip-update --log \
  > "$LOG" 2>&1 < /dev/null &
launch_pid=$!

for _ in $(seq 1 60); do
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    process_guard record "$launch_pid"
    echo "9router đã lên: http://$HOST:$PORT/dashboard  (pid $launch_pid, log $LOG)"
    exit 0
  fi
  sleep 0.5
done

echo "9router KHÔNG lên sau 30s. 30 dòng cuối log:" >&2
tail -30 "$LOG" >&2
exit 1
