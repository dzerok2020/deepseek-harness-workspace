#!/usr/bin/env bash
# Kiểm tra sức khoẻ DeepSeek Harness + workspace này.
# Mặc định không tái sinh config hoặc gọi LLM. Chạy: bash tools/dsh-health.sh
# --refresh-config ghi lại cordis.yml; --functional gọi LLM (có thể tốn phí).
#
# Mục đích: sau mỗi lần restart DSH hoặc cài plugin, chạy 1 lệnh này để biết
# hệ thống còn lành hay không, thay vì đoán.

REFRESH_CONFIG=0; FUNCTIONAL=0
usage() {
  printf '%s\n' 'Chạy: bash tools/dsh-health.sh [--refresh-config] [--functional]' \
    'Mặc định: đọc config đã sinh và kiểm tra thụ động; không tái sinh config, không gọi LLM.' \
    '  --refresh-config  Nạp lại profile bằng --dump-config; ghi cordis.yml.' \
    '  --functional      Kiểm chứng trích xuất Hindsight bằng LLM; có thể phát sinh chi phí.'
}
for arg in "$@"; do
  case "$arg" in
    --refresh-config) REFRESH_CONFIG=1 ;;
    --functional) FUNCTIONAL=1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'LỖI: tham số không hỗ trợ: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0

ok()   { printf '  \033[32mĐẠT\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mLỖI\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
note() { printf '       %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
SKIP=0
skip() { printf '  \033[33mBỎ QUA\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }

# Sandbox của agent (bwrap --ro-bind / --unshare-pid) không nối được user bus
# systemd và không ghi được file ngoài workspace. Hai probe dưới đây tách
# "dịch vụ chết thật" khỏi "không nhìn thấy được từ sandbox": báo BỎ QUA thay
# vì LỖI giả — bằng chứng sống thật là các HTTP probe ngay phía dưới.
BUS_OK=1
case "$(systemctl --user is-system-running 2>&1 || true)" in
  *Failed\ to\ connect*) BUS_OK=0 ;;
esac

unit_enabled() { # $1=unit $2=msg-đạt $3=msg-lỗi-kèm-lệnh-sửa
  if   [ "$BUS_OK" -eq 0 ]; then skip "$1 is-enabled: không kiểm được từ sandbox agent — mở terminal: systemctl --user is-enabled $1"
  elif [ "$(systemctl --user is-enabled "$1" 2>/dev/null)" = "enabled" ]; then ok "$2"
  else bad "$3"; fi
}
unit_active() { # $1=unit $2=msg-đạt $3=msg-lỗi-kèm-lệnh-sửa
  if   [ "$BUS_OK" -eq 0 ]; then skip "$1 is-active: không kiểm được từ sandbox agent — tin HTTP probe bên dưới; hoặc terminal: systemctl --user is-active $1"
  elif systemctl --user is-active --quiet "$1" 2>/dev/null; then ok "$2"
  else bad "$3"; fi
}

head_ "1. DSH cài đặt được"
if command -v dsh >/dev/null 2>&1; then ok "dsh có trong PATH ($(dsh --version 2>/dev/null | head -1))"
else bad "không tìm thấy lệnh dsh trong PATH"; fi

head_ "2. Profile: config đã sinh và kiểm chứng nạp bundle"
if [ "$REFRESH_CONFIG" -eq 1 ]; then
  DUMP_ERR="$(mktemp)"; DUMP_OUT="$(mktemp)"
  dsh --profile web --dump-config >"$DUMP_OUT" 2>"$DUMP_ERR" && DUMP_RC=0 || DUMP_RC=$?
  # --dump-config ghi cordis.yml từ patch; EROFS là giới hạn môi trường.
  if [ "$DUMP_RC" -ne 0 ] && grep -qE 'EROFS|read-only file system' "$DUMP_ERR"; then
    skip "dsh --dump-config: phải ghi cordis.yml nên chết EROFS trong sandbox agent — chạy lại mục này từ terminal thường"
  elif [ "$DUMP_RC" -eq 0 ]; then
    ok "dsh --dump-config chạy thành công ($(wc -l <"$DUMP_OUT") dòng)"
    if [ -s "$DUMP_ERR" ]; then bad "có cảnh báo/lỗi ở stderr khi nạp profile:"; head -10 "$DUMP_ERR" | sed 's/^/       /'
    else ok "stderr rỗng (không có cảnh báo khi nạp)"; fi
  else
    bad "dsh --dump-config THẤT BẠI — đọc lỗi bên dưới"
    head -20 "$DUMP_ERR" | sed 's/^/       /'
  fi
  rm -f "$DUMP_ERR" "$DUMP_OUT"
else
  if [ -r "$PROFILE/cordis.yml" ]; then
    if wc -l "$PROFILE/cordis.yml" >/dev/null; then ok "đọc được cordis.yml đã sinh (có thể cũ; không tái sinh)"
    else bad "không đọc được cordis.yml đã sinh"; fi
  else
    skip "chưa có cordis.yml đọc được; không tự sinh config"
  fi
  skip "chưa kiểm chứng tái sinh/nạp bundle; --refresh-config sẽ ghi lại cordis.yml"
fi

head_ "3. Plugin chống lặp đã được cài"
if N="$(node -p "try{require(process.argv[1]).dsh.profile.bundles.length}catch(e){-1}" "$PROFILE/package.json" 2>/dev/null)" && [[ "$N" =~ ^[0-9]+$ ]]; then
  ok "số bundle: $N"
else bad "không đọc được package.json của profile"; fi
grep -qE "dsh-loop-guard" "$PROFILE/package.json" 2>/dev/null \
  && ok "dsh-loop-guard có trong danh sách bundle" \
  || bad "dsh-loop-guard CHƯA được cài (chạy: dsh plugin --profile web add file:$WS/dsh-loop-guard)"
if [ -f "${DSH_HOME:-$HOME/.dsh}/loop-guard-status.json" ]; then
  ok "loop-guard đã chạy ít nhất 1 lần (có loop-guard-status.json)"
  note "$(node -p "const s=require(process.argv[1]);'enabled='+s.enabled+'  assemblies='+s.counters.assemblies+'  freezes='+s.counters.freezes+'  reinserts='+s.counters.reinserts+'  sessions đang giữ='+s.activeSessions" "${DSH_HOME:-$HOME/.dsh}/loop-guard-status.json" 2>/dev/null)"
else
  note "loop-guard-status.json chưa có — bình thường nếu chưa restart DSH kể từ lúc cài."
  note "Sau khi restart, gửi 1 prompt bất kỳ rồi kiểm tra lại mục này."
fi

head_ "4. Không còn bản gói host cũ lồng nhau (nguồn gây disable hàng loạt)"
# Chỉ đường dẫn có >=2 đoạn /node_modules/ mới là bản lồng thật.
# (Thư mục lib/ hay src/ BÊN TRONG một gói top-level không phải bản lồng.)
NESTED="$(find "$PROFILE/node_modules" -maxdepth 5 -type d -path '*/node_modules/@deepseek-ai/*' 2>/dev/null | awk -F'/node_modules/' 'NF>=3')"
if [ -z "$NESTED" ]; then ok "không có bản @deepseek-ai/* lồng trong node_modules"
else bad "còn bản lồng (dễ làm runtime tắt cả row dùng gói đó):"; echo "$NESTED" | sed 's/^/       /'; fi
RUNTIME_VER="$(dsh --version 2>/dev/null | head -1 | tr -d '[:space:]')"
VER_SF="$(node -p "try{require(process.argv[1]).version}catch(e){'THIẾU'}" "$PROFILE/node_modules/@deepseek-ai/dsh-skill-filesystem/package.json" 2>/dev/null)"
if [ -n "$RUNTIME_VER" ] && [ "$VER_SF" = "$RUNTIME_VER" ]; then ok "@deepseek-ai/dsh-skill-filesystem = $VER_SF (khớp runtime $RUNTIME_VER)"
else bad "@deepseek-ai/dsh-skill-filesystem = $VER_SF (nên khớp runtime ${RUNTIME_VER:-?})"; fi
VER_OV="$(node -p "try{require(process.argv[1]).version}catch(e){'THIẾU'}" "$PROFILE/node_modules/@openviking/dsh-memory-plugin/package.json" 2>/dev/null)"
case "$VER_OV" in 0.5.1[7-9]|0.5.[2-9]*) ok "@openviking/dsh-memory-plugin = $VER_OV (peer cho phép 0.2.x)";;
  *) bad "@openviking/dsh-memory-plugin = $VER_OV (0.5.16 trở xuống chặn 0.2.x — hãy nâng lên >=0.5.19)";; esac

head_ "5. Skill của bạn được nhận đủ"
NSKILL="$(find "${DSH_HOME:-$HOME/.dsh}/skills" -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
[ "$NSKILL" -ge 70 ] && ok "tìm thấy $NSKILL skill trong ~/.dsh/skills" \
  || bad "chỉ thấy $NSKILL skill — kiểm tra lại mục 4 (bản lồng từng làm mất skill)"

head_ "6. Hai plugin cục bộ vẫn qua test"
for p in dsh-loop-guard dsh-vibe-guard; do
  if [ -d "$WS/$p/test" ]; then
    if (cd "$WS/$p" && node --test test/ >/dev/null 2>&1); then ok "$p: test xanh"
    else bad "$p: test ĐỎ — chạy 'node --test test/' trong $WS/$p để xem chi tiết"; fi
  else note "$p: chưa có thư mục test (bỏ qua)"; fi
done

head_ "6b. Regression của bộ kiểm chứng và tài liệu workspace"
if python3 "$WS/test/hindsight-health.test.py" \
   && python3 "$WS/test/orchestration-health.test.py" \
   && python3 "$WS/test/model-budgets-catalog.test.py" \
   && python3 "$WS/test/model-budget-sync.test.py" \
   && python3 "$WS/test/model-budget-check.test.py" \
   && (cd "$WS" && node --test test/); then
  ok "test bộ kiểm chứng bộ nhớ, chuỗi ChatGPT, ngân sách model và tài liệu workspace xanh"
else
  bad "regression bộ kiểm chứng hoặc tài liệu workspace ĐỎ"
fi

head_ "7. Ba plugin cục bộ: bản DSH nạp có khớp code trong workspace không"
# pnpm COPY (không symlink) các dep file:, và giữ bản copy trong cache của nó.
# Nếu mục này báo BẢN SAO CŨ thì mọi thay đổi bạn sửa trong workspace đều KHÔNG
# được DSH chạy — không có cảnh báo nào khác. Sửa: bash tools/sync-local-plugins.sh --fix
for p in dsh-decide dsh-vibe-guard dsh-loop-guard dsh-tool-name-normalize; do
  src="$WS/$p"; dst="$PROFILE/node_modules/$p"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    ok "$p: symlink trỏ về workspace"
  elif [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
    bad "$p: CHƯA CÀI (dsh plugin --profile web add file:$src)"
  elif diff -rq --exclude=node_modules --exclude=.git "$dst" "$src" >/dev/null 2>&1; then
    note "$p: bản sao (nội dung còn khớp, nhưng lần sau sửa code sẽ không có tác dụng → nên --fix)"
  else
    bad "$p: BẢN SAO CŨ — code sửa trong workspace KHÔNG được DSH chạy (bash tools/sync-local-plugins.sh --fix)"
  fi
done

head_ "8. Kỷ luật Git của workspace"
if git -C "$WS" rev-parse --git-dir >/dev/null 2>&1; then
  C="$(git -C "$WS" rev-list --count HEAD 2>/dev/null || echo 0)"
  [ "$C" -ge 1 ] && ok "đã có $C commit" || bad "repo chưa có commit nào (kỷ luật Git chưa bắt đầu)"
  GL="$(git -C "$WS" ls-files -s | awk '$1=="160000"{print $4}')"
  [ -z "$GL" ] && ok "không có gitlink hỏng trong index" || bad "còn gitlink: $GL"
  if [ -z "$(git -C "$WS" status --porcelain)" ]; then ok "worktree sạch (không có thay đổi chưa commit)"
  else note "có thay đổi chưa commit:"; git -C "$WS" status --short | sed 's/^/       /'; fi
  for f in AGENTS.md .gitignore; do
    [ -f "$WS/$f" ] && ok "có $f" || bad "THIẾU $f"
  done
else bad "workspace chưa được git init"; fi

head_ "9. Dịch vụ Laya (System-1 — backend của tool decide)"
# Laya chết im lặng: tool decide KHÔNG báo lỗi rõ, nó chỉ rơi xuống Jev rồi trả số
# kém tin cậy (checkpoint còn cảnh báo confidence chưa hiệu chuẩn). Mục này để nhìn ra.
UNIT="$HOME/.config/systemd/user/laya-serve.service"
SRC="$WS/systemd/laya-serve.service"
if [ -L "$UNIT" ] && [ "$(readlink "$UNIT")" = "$SRC" ]; then ok "unit là symlink trỏ về workspace"
elif [ -L "$UNIT" ]; then bad "unit trỏ sai chỗ: $(readlink "$UNIT") (muốn: $SRC)"
elif [ -f "$UNIT" ]; then bad "unit là bản sao, không phải symlink (sửa trong repo sẽ không có tác dụng)"
else bad "THIẾU $UNIT — bật: ln -sfn $SRC $UNIT && systemctl --user daemon-reload && systemctl --user enable --now laya-serve.service"; fi
unit_enabled laya-serve.service "đã enable (tự chạy khi đăng nhập — linger đang bật)" \
  "CHƯA enable: systemctl --user enable laya-serve.service"
unit_active laya-serve.service "laya-serve.service đang chạy" \
  "laya-serve.service KHÔNG chạy — decide sẽ rơi xuống Jev: systemctl --user start laya-serve.service"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8000/health 2>/dev/null)"
[ "$CODE" = "200" ] && ok "GET /health = 200 (Laya sẵn sàng ở 127.0.0.1:8000; nạp model lần đầu ~16s)" \
  || bad "GET /health = ${CODE:-000} — Laya chưa sẵn sàng"

head_ "10. Dịch vụ Hindsight (bộ nhớ dài hạn của DSH)"
# Hindsight chết im lặng: DSH vẫn chạy bình thường, chỉ là không có ký ức nào được
# ghi vào hay nạp ra (đã từng có 1038 lần retain thất bại mà không hiện lỗi ở đâu).
# Mục này để nhìn ra, gồm cả trang quản trị ở http://localhost:9999.
unit_active hindsight-daemon.service "hindsight-daemon.service đang chạy" \
  "hindsight-daemon.service KHÔNG chạy — DSH sẽ chạy mà không có ký ức: systemctl --user start hindsight-daemon.service"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9077/health 2>/dev/null)"
[ "$CODE" = "200" ] && ok "GET 127.0.0.1:9077/health = 200 (daemon sẵn sàng)" \
  || bad "GET 127.0.0.1:9077/health = ${CODE:-000} — daemon chưa sẵn sàng"

UNIT="$HOME/.config/systemd/user/hindsight-control-plane.service"
SRC="$WS/systemd/hindsight-control-plane.service"
if [ -L "$UNIT" ] && [ "$(readlink "$UNIT")" = "$SRC" ]; then ok "unit control plane là symlink trỏ về workspace"
elif [ -L "$UNIT" ]; then bad "unit control plane trỏ sai chỗ: $(readlink "$UNIT") (muốn: $SRC)"
elif [ -f "$UNIT" ]; then bad "unit control plane là bản sao, không phải symlink (sửa trong repo sẽ không có tác dụng)"
else bad "THIẾU $UNIT — bật: ln -sfn $SRC $UNIT && systemctl --user daemon-reload && systemctl --user enable --now hindsight-control-plane.service"; fi
unit_enabled hindsight-control-plane.service "đã enable (tự chạy khi đăng nhập — linger đang bật)" \
  "CHƯA enable: systemctl --user enable hindsight-control-plane.service"
unit_active hindsight-control-plane.service "hindsight-control-plane.service đang chạy" \
  "hindsight-control-plane.service KHÔNG chạy — http://localhost:9999 không mở được: systemctl --user start hindsight-control-plane.service"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9999/api/health 2>/dev/null)"
[ "$CODE" = "200" ] && ok "GET 127.0.0.1:9999/api/health = 200 (trang quản trị: http://localhost:9999)" \
  || bad "GET 127.0.0.1:9999/api/health = ${CODE:-000} — trang quản trị chưa sẵn sàng"
# Trang quản trị KHÔNG có xác thực: chỉ được nghe ở loopback.
if ss -ltn 2>/dev/null | grep -q '0\.0\.0\.0:9999'; then
  bad "control plane nghe trên 0.0.0.0:9999 mà KHÔNG có xác thực — cả LAN đọc được bộ nhớ (đặt HOSTNAME=127.0.0.1 trong unit)"
else ok "control plane chỉ nghe trên loopback (không lộ bộ nhớ ra LAN)"; fi

head_ "10b. Kiểm chứng bộ nhớ (mặc định không gọi LLM)"
if [ "$FUNCTIONAL" -eq 1 ]; then
  if python3 "$WS/tools/hindsight-health.py" --functional; then
    ok "Hindsight qua các kiểm tra không bị hoãn; xem trạng thái trích xuất LLM ở trên"
  else
    bad "Hindsight chưa qua kiểm chứng chức năng — /health=200 không đủ"
  fi
else
  if python3 "$WS/tools/hindsight-health.py"; then
    ok "Hindsight qua /health, loopback và quyền file (không gọi LLM)"
  else
    bad "Hindsight chưa qua kiểm tra thụ động /health, loopback hoặc quyền file"
  fi
  skip "chưa kiểm chứng trích xuất LLM; --functional có thể phát sinh chi phí (không lưu dữ liệu)"
fi

head_ "11. Dịch vụ OmniRoute + Headroom (chuỗi model của provider \`or\`)"
# OmniRoute = gateway model chính (127.0.0.1:20128); Headroom = proxy anthropic (8787)
# mà DSH provider `or` gọi vào: dsh -> headroom:8787 -> omniroute:20128 -> upstream.
# Chuỗi này chết = mọi hội thoại qua `or` chết (kể cả session đang chạy).
# Chi tiết vận hành: docs/omniroute-setup.md
UNIT="$HOME/.config/systemd/user/omniroute.service"
SRC="$WS/systemd/omniroute.service"
if [ -L "$UNIT" ] && [ "$(readlink "$UNIT")" = "$SRC" ]; then ok "unit là symlink trỏ về workspace"
elif [ -L "$UNIT" ]; then bad "unit trỏ sai chỗ: $(readlink "$UNIT") (muốn: $SRC)"
elif [ -f "$UNIT" ]; then bad "unit là bản sao, không phải symlink (sửa trong repo sẽ không có tác dụng) — bật: ln -sfn $SRC $UNIT && systemctl --user daemon-reload"
else bad "THIẾU $UNIT — bật: ln -sfn $SRC $UNIT && systemctl --user daemon-reload && systemctl --user enable --now omniroute.service"; fi
unit_enabled omniroute.service "omniroute đã enable (tự chạy khi đăng nhập — linger đang bật)" \
  "omniroute CHƯA enable: systemctl --user enable omniroute.service"
unit_active omniroute.service "omniroute.service đang chạy" \
  "omniroute.service KHÔNG chạy — DSH không gọi được model nào: systemctl --user start omniroute.service (KHÔNG dùng 'omniroute stop' khi unit chạy)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:20128/api/health 2>/dev/null)"
[ "$CODE" = "200" ] && ok "GET 127.0.0.1:20128/api/health = 200 (dashboard: http://localhost:20128)" \
  || bad "GET 127.0.0.1:20128/api/health = ${CODE:-000} — OmniRoute chưa sẵn sàng (khởi động ~10s)"
if ss -ltn 2>/dev/null | grep -q '0\.0\.0\.0:20128'; then
  bad "OmniRoute nghe trên 0.0.0.0:20128 trong khi REQUIRE_API_KEY=false — cả LAN xài nhờ được (sửa OMNIROUTE_SERVER_HOST=127.0.0.1 trong ~/.omniroute/.env rồi systemctl --user restart omniroute.service)"
else ok "OmniRoute chỉ nghe trên loopback (không lộ gateway ra LAN)"; fi
unit_active headroom-proxy.service "headroom-proxy.service đang chạy" \
  "headroom-proxy.service KHÔNG chạy — provider or của DSH chết theo: systemctl --user start headroom-proxy.service"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8787/v1/models 2>/dev/null)"
case "$CODE" in
  401|403|200) ok "headroom 127.0.0.1:8787 đáp HTTP $CODE (401/403 là đúng — proxy giữ nguyên xác thực tới OmniRoute)" ;;
  *) bad "headroom 127.0.0.1:8787 = ${CODE:-000} — chuỗi dsh→or có thể đang chết" ;;
esac

head_ "12. Chuỗi ChatGPT Web — kiểm chứng CHỨC NĂNG (không chỉ HTTP 200)"
# shim phải báo mode browser-only, bridge phải accepting_turns, catalog phải có
# model pipeline thật dùng. Bridge chết = Architect/Reviewer rơi về native (fallback),
# không hỏng hẳn — nhưng bạn cần biết để mở lại tab ChatGPT trong launcher.
if python3 "$WS/tools/orchestration-health.py"; then ok "shim + bridge + catalog đạt (chức năng)"
else bad "chuỗi ChatGPT Web chưa đạt — pipeline sẽ fallback native; xem dòng LỖI ở trên"; fi

head_ "12b. Ngân sách model — profile có khớp tham chiếu Git không"
# Tách khỏi mục 12: thêm model trong Settings mà chưa chạy
# tools/sync_model_budgets.py chỉ làm lệch tham chiếu, không phải shim/bridge hỏng.
if python3 "$WS/tools/model-budget-check.py"; then ok "ngân sách context/maxTokens khớp tham chiếu Git"
else bad "profile lệch tham chiếu — chạy tools/sync_model_budgets.py để xem trước, rồi --apply"; fi

head_ "13. Ngân sách prompt — có đang phình/đốt token không"
# Đo phần cố định phải trả mỗi request (tool schema, catalog skill) + mật độ
# snapshot runtime + nhắc 灵枢 trong LƯỢT HIỆN TẠI. Nhắc 灵枢 quay lại = patch
# đếm lượt của dsh-memory đã bị ghi đè khi cài lại plugin (xem
# vibe-analysis/2026-10-28-p0-fixes.md).
if node "$WS/tools/prompt-budget.mjs" --check; then
  ok "tool schema + catalog skill + snapshot + cache hit trong ngưỡng"
else
  bad "ngân sách prompt vượt ngưỡng — xem dòng LỖI ở trên (đo bằng tools/prompt-budget.mjs)"
fi

head_ "14. Preset agent — cấu hình từng row có mount được không"
# Bắt lỗi kiểu tool-subagent thiếu `provider` (Config required) làm cả preset
# không chọn được trong GUI. Kiểm Config của từng plugin + resolve module.
if node "$WS/tools/preset-check.mjs" >/tmp/preset-check.log 2>&1; then
  ok "$(tail -1 /tmp/preset-check.log | sed 's/^ *//') — mọi row khai đúng Config và resolve được"
else
  sed -n 1,20p /tmp/preset-check.log >&2
  bad "preset hỏng cấu hình — xem dòng LỖI ở trên (tools/preset-check.mjs)"
fi

printf '\n\033[1mKẾT QUẢ:\033[0m %d đạt, %d lỗi, %d bỏ qua\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then echo "Có mục cần xử lý — xem các dòng LỖI ở trên."
elif [ "$SKIP" -gt 0 ]; then printf 'Đạt các mục đã kiểm; %d mục BỎ QUA có chủ đích hoặc do giới hạn môi trường — xem từng dòng BỎ QUA, chưa phủ đủ.\n' "$SKIP"
else echo "Các kiểm tra trong script đều đạt; không thay thế kiểm thử tải, UI hoặc nghiệm thu dự án thật."; fi
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
