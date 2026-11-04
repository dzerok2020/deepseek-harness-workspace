---
name: four-phase-build
description: "Điều phối quy trình 4 pha làm phần mềm cùng AI (bốn bước: 环境搭建 → 产品方案 → 技术方案 → 产品实现) lấy từ video '如何使用 AI 写代码'. Dùng khi user yêu cầu xây một sản phẩm/tính năng phần mềm hoàn chỉnh mà chưa có repo+plan, hoặc nói 'làm theo quy trình 4 bước', 'quy trình trong video', 'từ ý tưởng tới app', 'don't vibe code'. Mỗi pha có skill riêng; skill này giữ cổng giao giữa các pha và quy tắc ủy quyền theo 复杂度/重要性."
---

# Four-Phase Build — điều phối quy trình 4 pha

Nguyên tắc gốc của video: **không vibe coding**. Trước khi AI viết code phải dựng nền móng (Git + AGENTS.md), chốt phương án sản phẩm, chốt phương án kỹ thuật, rồi mới triển khai. Mỗi pha kết thúc bằng một **artefact bền** (file/commit), pha sau đọc artefact của pha trước.

## Pipeline và cổng giao (gate)

| # | Pha | Skill | Artefact bắt buộc trước khi sang pha sau |
|---|-----|-------|------------------------------------------|
| 1 | 环境搭建 (dựng môi trường) | `four-phase-env-setup` | Repo Git sạch + `AGENTS.md` + commit đầu tiên |
| 2 | 产品方案 (phương án sản phẩm) | `four-phase-product-plan` | `docs/product-plan.md` được user duyệt |
| 3 | 技术方案 (phương án kỹ thuật) | `four-phase-tech-plan` | `docs/tech-plan.md` (stack + cấu trúc) được user OK |
| 4 | 产品实现 (triển khai) | `four-phase-implement` | Code chạy thật + verification report + xác nhận của người |

- Gọi đúng skill pha bằng tool `skill` khi bắt đầu mỗi pha; không tự ý nhảy pha. Người dùng yêu cầu thẳng một pha (ví dụ chỉ "lên phương án sản phẩm") thì chạy riêng pha đó, không ép cả pipeline.
- Gate bị bỏ qua phải xin lỗi và quay lại补: thiếu `AGENTS.md` thì code sinh ra không kiểm soát được; thiếu docs thì "AI dễ sinh bug ra" (tự bịa yêu cầu).
- Với thay đổi nhỏ (fix bug, thêm nút) trên repo đã có nền móng: không chạy cả 4 pha — chỉ cần cam kết commit+test của `four-phase-implement`.

## Quy tắc ủy quyền (giao việc cho AI nhiều hay ít)

Cân nhắc theo ** độ phức tạp (复杂度) × tầm quan trọng (重要性)** — video: "由浅入深...根据复杂度和重要性来判断":

- Thấp (lặt vặt cơ học, đã có plan rõ): giao AI làm trọn gói, người chỉ nghiệm thu.
- Trung bình: AI làm từng lát nhỏ, mỗi lát commit + test, người xem diff.
- Cao / liên quan tiền, dữ liệu, bảo mật, kiến trúc: con người quyết thiết kế, AI chỉ soạn thảo/phản biện; kết quả nào cũng phải chạy thật + người kiểm tra (人工验证 là cổng cuối, "AI không bao giờ chuẩn 100%").

Cơ chế ủy quyền trong DeepSeek Harness:
- Việc nền độc lập, nhiều bước: `subagent` / `spawn_teammate` (teammate nhận cùng catalog skill + AGENTS.md của repo).
- Muốn một coding CLI khác làm (như video dùng Codex): `conductor_dispatch` (agent opencode/codex/...).
- Tự làm trong phiên hiện tại khi cần tương tác chặt với user (hỏi scope, duyệt plan).

## Nhịp làm việc chung

1. Đầu mỗi pha: tóm tắt ngắn artefact sẽ tạo ra + hỏi user nếu thiếu thông tin then chốt (scope, nền tảng đích).
2. Cuối mỗi pha: commit artefact (theo luật AGENTS.md), báo cho user gate đã mở, xin duyệt trước khi sang pha tiếp nếu gate yêu cầu.
3. Khi app lỗi thật ở pha 4: dán log/nguyên văn thông báo lỗi cho AI sửa, tái hiện bằng chạy thật — không đoán mò.
