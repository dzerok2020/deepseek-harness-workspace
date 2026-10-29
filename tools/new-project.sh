#!/usr/bin/env bash
# new-project.sh — tạo dự án mới đúng chuẩn vibe code ngay từ phút đầu.
#
# Việc nó làm (chỉ trong thư mục mới, KHÔNG chạm gì khác):
#   1. Tạo thư mục dự án
#   2. git init
#   3. Chép .gitignore và AGENTS.md từ tools/templates/
#   4. Commit đầu tiên
#   5. In ra các bước tiếp theo
#
# Dùng:  bash tools/new-project.sh <đường-dẫn-thư-mục-mới>
# Ví dụ: bash tools/new-project.sh ~/Documents/ung-dung-hoc-tieng-anh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="$HERE/templates"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Dùng: bash tools/new-project.sh <đường-dẫn-thư-mục-mới>"
  echo "Ví dụ: bash tools/new-project.sh ~/Documents/du-an-cua-toi"
  exit 1
fi

# Đổi ~ thành thư mục nhà
case "$TARGET" in
  "~/"*) TARGET="$HOME/${TARGET#\~/}" ;;
esac

if [ ! -f "$TPL/AGENTS.md" ] || [ ! -f "$TPL/gitignore" ]; then
  echo "LỖI: không tìm thấy khuôn trong $TPL"
  exit 1
fi

if [ -e "$TARGET" ]; then
  echo "LỖI: '$TARGET' đã tồn tại. Chọn tên khác để không ghi đè dữ liệu."
  exit 1
fi

NAME="$TARGET"
while [[ "$NAME" == */ ]]; do NAME="${NAME%/}"; done
NAME="${NAME##*/}"
mkdir -p "$TARGET"
cp "$TPL/gitignore" "$TARGET/.gitignore"
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "${line//"{{TÊN_DỰ_ÁN}}"/"$NAME"}"
done < "$TPL/AGENTS.md" > "$TARGET/AGENTS.md"

cd "$TARGET"
git init -q
git add -A
git -c commit.gpgsign=false commit -q -m "chore: khởi tạo dự án theo chuẩn vibe code" \
  || { echo "LỖI: git commit thất bại. Kiểm tra 'git config user.email' và 'user.name'."; exit 1; }

echo "✅ Đã tạo dự án: $TARGET"
echo
echo "Đã có sẵn:"
echo "  - Git repo + commit đầu tiên"
echo "  - .gitignore (bỏ node_modules, .env, file rác)"
echo "  - AGENTS.md (hợp đồng làm việc cho AI: Definition of Done, 4 nhịp sửa lỗi, kỷ luật Git)"
echo
echo "Việc tiếp theo của bạn:"
echo "  1. cd \"$TARGET\""
echo "  2. Mở AGENTS.md, điền mục §1 (lệnh chạy + lệnh test) khi đã có code"
echo "  3. Nói với AI mục tiêu MVP (1-3 câu) rồi bắt đầu"
echo "  4. Muốn đẩy lên GitHub:  gh repo create $NAME --private --source . --push"
