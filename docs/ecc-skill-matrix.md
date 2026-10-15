# Đối chiếu ECC skills với DeepSeek Harness (15/10/2026)

Nguồn: [ECC tại commit b92f181b3b748d1abbc2afd94af6aa7d8c8fca29](https://github.com/affaan-m/ECC/tree/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills); đối chiếu với catalog DSH hiện hành và các skill ở `~/.dsh/skills/`. **Skill là hướng dẫn cho agent, không phải chương trình tự động nâng chất lượng code.** Hai skill ECC đã có từ lượt trước là `agent-harness-construction` và `agent-introspection-debugging`; bảng dưới phân loại các ứng viên liên quan trực tiếp đến lập kế hoạch, code, test và kiểm chứng. Không cài toàn bộ 311 skill hoặc các hook/rule/agent của Claude Code.

## Cài thêm: 5 kỹ năng bổ sung khác biệt

| ECC skill | DSH đã có | Điểm bổ sung và phạm vi sử dụng |
| --- | --- | --- |
| [change-impact](https://github.com/affaan-m/ECC/blob/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/change-impact/SKILL.md) | `code-review`, `anti-entropy-governance` | Phân tích blast radius (vùng ảnh hưởng) trước thay đổi đa mô-đun, rồi đối chiếu diff thực tế sau sửa; xét dữ liệu, hợp đồng, test, triển khai, rollback. Mặc định chỉ đọc. |
| [contract-first](https://github.com/affaan-m/ECC/blob/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/contract-first/SKILL.md) | `four-phase-tech-plan`, `domain-modeling` | Chốt OpenAPI/AsyncAPI/JSON Schema/Proto làm hợp đồng có thể kiểm bằng máy; sinh type, kiểm cả consumer và provider. Chỉ khi có ranh giới dịch vụ hoặc nhóm làm độc lập, không thêm cho một module đơn giản. |
| [test-collaboration](https://github.com/affaan-m/ECC/blob/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/test-collaboration/SKILL.md) | `tdd`, `four-phase-implement` | Liên kết requirement, bug, risk với TEST-ID và lệnh kiểm chứng có thể chạy; quản lý *tài sản test*, không thay quy trình test-first. Template đi kèm liên kết skill. |
| [module-regression](https://github.com/affaan-m/ECC/blob/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/module-regression/SKILL.md) | `verification-before-completion`, `code-review` | Sổ `REGRESSION.md` ánh xạ module → consumer phía sau → lệnh acceptance; hữu ích khi nhiều module phụ thuộc nhau hoặc đã có lỗi lan truyền, không áp dụng máy móc cho repo nhỏ. Template đi kèm liên kết skill. |
| [production-audit](https://github.com/affaan-m/ECC/blob/b92f181b3b748d1abbc2afd94af6aa7d8c8fca29/skills/production-audit/SKILL.md) | `verification-before-completion`, `observability-and-instrumentation` | Rà soát rủi ro trước phát hành ứng dụng bằng chứng cứ tại chỗ (vận hành, dữ liệu, UX, bảo mật), không gửi repo tới dịch vụ audit bên ngoài; không phải chứng nhận compliance. |

**Cách cài:** liên kết nguyên thư mục từ `~/.dsh/ecc/source/skills/<tên>` vào `~/.dsh/skills/<tên>`; nguồn được ghim tại commit trên. Đây là lựa chọn cài toàn cục cho các phiên DSH, không thay `AGENTS.md` của dự án và không cần chạy installer ECC. Việc hiện trong catalog và load `SKILL.md` xác nhận khả năng khám phá; **chưa chứng minh hiệu quả khi giải một bài code thực tế**.

## Đã có tương đương: không cài trùng

| ECC skill | DSH hiện có / lý do |
| --- | --- |
| `blueprint`, `intent-driven-development`, `product-capability` | `writing-plans`, `four-phase-product-plan`, `four-phase-tech-plan`, `to-spec`; có ích làm tài liệu tham khảo khi thật sự cần đặc tả sâu, không nên áp quy trình song song. |
| `tdd-workflow`, `ai-regression-testing` | `tdd`, `diagnosing-bugs`, quy trình test đỏ → sửa → chạy test của workspace; ví dụ ECC có giả định stack riêng. |
| `verification-loop`, `agent-self-evaluation` | `verification-before-completion` và checklist Definition of Done của `AGENTS.md`; tránh thêm cổng báo xanh trùng hoặc đánh giá chủ quan thay bằng chứng. |
| `coding-standards`, `agentic-engineering`, `conventional-commit-review`, `git-workflow` | `karpathy-guidelines`, `four-phase-implement`, kỷ luật Git của `AGENTS.md`; không áp mẫu force-push hoặc convention commit nếu dự án chưa chọn. |
| `architecture-decision-records`, `security-review` | `recording-architecture-decisions`, `code-security-audit`; cùng mục đích chính. |
| `search-first`, `iterative-retrieval`, `codebase-onboarding`, `agent-sort`, `living-docs-governance`, `docs-governance` | `research`, `agent-reach`, `context-engineering`, Hindsight/`AGENTS.md`; tránh tạo thêm nguồn hướng dẫn cạnh tranh hoặc gọi lệnh Claude Code. |

## Chỉ xem xét khi xuất hiện nhu cầu cụ thể

- **Viết test theo stack:** `e2e-testing` cho *bộ test Playwright lưu trong repo* (khác `webapp-testing` kiểm tra trình duyệt tại chỗ); `react-testing` cho RTL/Vitest/MSW; `python-testing` cho pytest. Không sao chép cấu hình `localhost:3000` vì GUI DSH ở `:3080` và cần bootstrap của DSH.
- **Thiết kế API và agent:** `api-design` khi có API REST, `eval-harness` / `agent-eval` khi đo độ ổn định agent qua nhiều lần chạy, `agent-architecture-audit` khi điều tra tương tác nhiều lớp agent. `agent-eval` còn cần CLI bên ngoài chưa được cài/kiểm chứng.
- **Quy trình nhóm:** `story-lifecycle` chỉ khi dự án muốn sổ story trong `.stories/` thay issue tracker (helper ledger Node đi kèm); `code-tour` khi cần tour code lưu lâu dài; `codebase-onboarding` nếu chấp nhận chỉnh để giữ `AGENTS.md` làm nguồn duy nhất.
- **Phụ thuộc môi trường khác — không cài:** `plan-canvas`, `plan-orchestrate`, `safety-guard`, `delivery-gate`, `security-scan` phụ thuộc binary, slash command, hook/biến môi trường Claude hoặc quét/cài thêm từ bên ngoài; xung đột hoặc chưa chứng minh tương thích với DSH.

Giới hạn: lựa chọn này được đánh giá trên bản ECC ghim commit, không tự cập nhật upstream. Các câu lệnh/test bên trong tài liệu ECC là nội dung tham khảo, không chạy tự động; quyền và kỷ luật của workspace vẫn là ưu tiên.
