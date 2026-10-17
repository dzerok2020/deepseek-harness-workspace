#!/usr/bin/env bash
# Sửa cưỡng bức ~/.dsh/profiles/web/cordis.patch.yml: mọi model của route or/cgw
# về contextWindow 128000 / maxTokens 16384 (chuẩn đã chốt 13:35 ngày 2026-10-17).
#
# Lý do tồn tại: process DSH/GUI đã 2 lần ghi đè file này về 1000000/131000/65000
# (catalog mặc định của upstream "trickle" vào patch khi GUI lưu settings).
# Sau khi chạy lệnh này BẮT BUỘC restart DSH: config đang chạy trong RAM, sửa đĩa
# một mình không có tác dụng (workspaces cache không invalidate).
set -e
F="${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml"
[ -f "$F" ] || { echo "KHÔNG THẤY $F"; exit 1; }
if ! grep -qE 'contextWindow: 1000000|maxTokens: (131000|65000|128000)\b' "$F"; then
  echo "ĐÃ SẠCH: không còn giá trị drift nào trong $F. Không sửa gì."
  exit 0
fi
cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)"
sed -E -i \
  's/^([[:space:]]*)contextWindow: 1000000\b/\1contextWindow: 128000/;
   s/^([[:space:]]*)maxTokens: (131000|65000|128000)\b/\1maxTokens: 16384/' "$F"
echo "ĐÃ SỬA (backup .bak- sát file gốc). Kiểm chứng lại:"
python3 "$(dirname "$0")/orchestration-health.py" 2>&1 | tail -2
echo "BƯỚC CUỐI: restart DSH để RAM nạp lại giá trị này."
