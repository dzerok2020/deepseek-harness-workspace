---
name: four-phase-env-setup
description: "Pha 1 环境搭建 (dựng môi trường) của quy trình 4 pha: tạo repo Git cho project mới, viết AGENTS.md làm 'luật làm việc' cho coding agent, commit đầu tiên, thiết lập checkpoint/rollback. Dùng khi bắt đầu project/codebase mới với AI, user nói 'dựng môi trường', 'khởi tạo repo', 'setup dự án', '环境搭建', hay khi chuẩn bị giao code cho AI mà repo chưa có Git/AGENTS.md."
---

# Pha 1 — 环境搭建: dựng nền móng Git + AGENTS.md

Mục tiêu: trước khi AI viết dòng code nào, mọi thay đổi phải (a) đảo được bằng Git, (b) tuân luật chung ghi trong `AGENTS.md`. Video: "Việc đầu tiên là để AI chủ động dựng Git repo... định chế hóa thành AGENTS.md".

## Các bước

1. **Chốt thư mục dự án.** Hỏi/确认 đường dẫn + tên project nếu chưa có. Kiểm tra `git rev-parse --is-inside-work-tree`:
   - Chưa phải repo → xác nhận với user rồi `git init`. KHÔNG tự init trong thư mục đã là repo khác.
   - Repo đã tồn tại → bỏ qua init, chỉ bổ sung phần thiếu (`.gitignore`, `AGENTS.md`).
2. **`.gitignore` trước commit đầu:** ít nhất `node_modules/`, `dist/`, `build/`, `.venv/`/`*venv/`, `*.log`, `.env*`, artifacts sinh tự động (frames/tạm của tool phân tích). Commit nền: `chore: init repo`.
3. **Viết `AGENTS.md`** ở gốc repo từ template dưới đây (Việt hóa hoặc song ngữ theo user; giữ nguyên các luật). Commit: `docs: add AGENTS.md`.
4. **Thỏa thuận checkpoint:** trước mỗi lát AI sửa đổi lớn, `git status` phải sạch; sau mỗi lát: commit + test (luật 1, 2 trong AGENTS.md). Khi kết quả hỏng: `git diff` để soi, `git checkout/revert` để lùi — đây là "sợi dây an toàn".
5. **Báo cáo gate:** đường dẫn repo, commit hash đầu tiên, file `AGENTS.md` đã có. Gate mở khi user đồng ý sang pha 2 (`four-phase-product-plan`).

## Template AGENTS.md

````markdown
# AGENTS.md — Luật làm việc cho coding agent

## Phạm vi & quy trình
1. Mỗi thay đổi = một commit nhỏ, kèm test tương ứng đã chạy (không commit vàng).
2. Không sửa code nằm ngoài yêu cầu hiện tại; không tự thêm dependency mới mà không ghi lý do vào commit message.
3. Tài liệu trước code: đọc `docs/product-plan.md` + `docs/tech-plan.md` (nếu tồn tại) trước khi viết tính năng; thiếu chúng thì yêu cầu làm rõ scope trước.
4. Có câu hỏi lớn về scope/kiến trúc → hỏi người, không đoán.

## Kiểm chứng (bắt buộc trong mỗi commit report)
- Test: <số pass/fail từng bộ>
- Lint / build / package / E2E (nếu áp dụng): pass/fail
- Lỗi thực thi khi chạy thật (log nguyên văn) và cách sửa

## An toàn đảo ngược
- `git status` sạch trước khi bắt đầu lát mới.
- Lát hỏng → revert về commit sạch gần nhất, không vá chồng lên hỏng.

## Con người là cổng cuối
Kết quả AI tạo không bao giờ được coi là đúng 100%; mọi tính năng phải chạy thật và người duyệt.
````

## Chống chỉ định

- Init repo bên trong thư mục chứa secrets đã commit sẵn → cảnh báo user.
- Bỏ `AGENTS.md` vì "project nhỏ": luật này chính là thứ pha 4 dựa vào để nghiệm thu.
- Dùng `git init -f` lên thư mục con của repo khác khi user chưa xác nhận.
