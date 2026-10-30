# ECC trên DSH — tích hợp chọn lọc, Hindsight làm memory owner

## Kết quả và quyền hiện hành

Người dùng đã chọn phương án A ngày 2026-10-30: DSH tiếp tục là host chính; giữ nguyên upstream ECC, tái sử dụng chức năng DSH đã có, kết hợp có chọn lọc và dùng Hindsight làm kho nhớ duy nhất. Phạm vi mới thay thế giới hạn lab-only trước đó: thử và kiểm chứng trong lab, sau đó đưa cấu hình đạt vào profile `web`, có backup/rollback và restart đúng GUI hiện có. Không cần hỏi lại quyết định A.

Full coverage không đồng nghĩa bật mọi process hoặc cam kết host parity. Mỗi nhóm chức năng và từng phần chưa thay thế phải có owner/trạng thái/lý do, không lấy source-present hay số test làm bằng chứng hoạt động thật.

## Lát B được duyệt — agents → hooks → connector theo nhu cầu

Người dùng ngày 2026-10-30 yêu cầu tự triển khai lộ trình đã đề xuất đến khi có bằng chứng thành công, không hỏi lại từng bước. Baseline lát B: `1fa4d7d`, worktree sạch; DSH/ECC pin và các ranh giới memory/model/credential của scope A giữ nguyên. Không bật toàn bộ ECC hoặc cài server không có nhu cầu.

- Pilot planner: public native composition, tool allowlist Read/Grep/Glob và routing hiện hành; không copy tool parent ra global, bỏ guard hay sửa core. Task-14 sở hữu module/test planner, Lead tích hợp.
- Hook nhỏ: cảnh báo JS/TS từ payload write/edit thành công, không đọc project/HOME/transcript, subprocess/network/LLM hoặc alternate store; không giả parity với Stop full-project scan. Task-15 sở hữu module/test, giữ nguyên containment.
- Connector/MCP: nhu cầu file/search/docs, ưu tiên native theo catalog từng scope; không bật 34 templates hay credential mới. Registration khác runtime proof. Server mới chỉ khi có gap cụ thể và review license/version/egress/permissions.
- Acceptance seams: public command/tool SDK, native agent/subagent composition và ToolRuntime; RED→GREEN late capability/sibling deny/cancel/disposal, hook success/failure/bounds. Full adapter/guards/health và bounded readonly planner smoke trên route hiện hành; lab→web với backup/rollback. Không gửi source sang provider khác.
- Impact: bootstrap/status/version, module/test mới, docs cùng record và profile override riêng nếu cần; không schema/migration/memory rewrite. Rollback riêng commit/config, không reset workspace. Public seam thiếu thì giữ unsupported, không nới quyền.

## Baseline và source of truth

- Workspace HEAD bắt đầu lát mới: `89e214d`; working tree sạch.
- DSH `0.2.1-rc.2`, Node `26.8.2`; ECC giữ pin `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29` tại `/home/dzerok/.dsh/ecc/source`; không sửa upstream hoặc DSH core.
- Adapter lab trước đó: 61/61 public-SDK fixtures xanh, chưa generation/GUI acceptance. Profile web chưa cài adapter. Đây là baseline, không phải nghiệm thu scope mới.
- [Hindsight primary](<../../../hindsight-primary.md>) sở hữu config/routing/quyền/chi phí memory. Native adapter `0.8.2`, server `0.10.3`; không đổi model, credential, bank hoặc tạo memory database khác.
- [Research](<../../../ecc-integration-research.md>) và [README adapter](<../../../../dsh-ecc-adapter/README.md>) ghi giới hạn của baseline. Health model-policy/catalog lỗi đã tồn tại, không tự đổi route để làm xanh.

## Phạm vi và ranh giới

1. Kiểm kê skills/commands/agents/rules/hooks/MCP; quyết định theo nội dung và contract, không theo tên giống nhau. Mỗi chức năng có một owner; bổ sung ECC không được đè native skill/instructions/guard.
2. Cầu nối memory dùng API công khai của Hindsight hiện có, cùng workspace/bank đã opt-in. Không chạy ECC vault/observer/summary model song song. Bảo toàn ID/metadata và xác nhận lưu; trả pending/error trung thực. Không xóa dữ liệu, chạy migration, reflect, page refresh, survey, hoặc cài MCP Hindsight thứ hai.
3. Giữ quy trình learning hữu ích khác với việc mở một kho nhớ mới. Entry cần filesystem/host gốc mà chưa có thay thế phải được báo, không âm thầm bật.
4. Tái sử dụng quyền/tool/model route/cost controls native. Không host khác, model ngoài hoặc MCP có credential mới. Chỉ server được chọn sau review hợp đồng; không bật toàn bộ templates.
5. Không tạo server thay GUI. Main rollout chỉ sau tests/review/compose; backup ngoài Git trước đổi profile; restart có thể ngắt session nên phải checkpoint trước.

## Seams nghiệm thu đã duyệt

- ECC memory API: save → receipt/completed hoặc pending → search → read theo ID; lỗi/timeout/collision/scopes/metadata; qua hai phiên mới không đưa đáp án vào query, không ghi vault ECC.
- Ownership policy: native owner và ECC supplement có căn cứ; unknown/lifecycle thiếu ghi rõ, duplicate names không được coi semantic-equivalent.
- Native SDK: command arguments/confirmation, agent tool/model scope, rules/skill resources và precedence, hook monotonic deny/Stop/containment giữ regression.
- Integration: source sạch/pin đúng, lab entry và main compose đúng, main status có per-asset owners, Hindsight cùng bank/config, provider/credential không đổi; kiểm chứng GUI/generation riêng với fixture.
- Regression: toàn bộ adapter, loop/vibe guards, generator ECC, health; ghi nguyên văn pass/fail và phần chưa verify. Commit theo lát, không push.

## Phân công và tiếp tục

Lead sở hữu memory bridge ban đầu, bootstrap/context integration, profile rollout và kiểm chứng tổng. Phạm vi teammate theo từng task trên board: native assets/ownership policies và các fix đã xác minh; hooks/policy và các fix memory receipt. Các task có write scopes tách biệt, get/claim trước làm và freeze trước review cuối; không suy ra quyền sửa ngoài task. Trạng thái cuối và các nhiệm vụ đã hoàn tất nằm ở checkpoint.

Trạng thái mới nhất và resume: [20-checkpoint.md](<20-checkpoint.md>). Bằng chứng cũ chỉ đóng phạm vi lab cũ; không dùng thay bằng chứng scope A.
