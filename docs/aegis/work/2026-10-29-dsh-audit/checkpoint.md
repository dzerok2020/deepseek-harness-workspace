# Kiểm tra và sửa DSH — 2026-10-29

## Trạng thái hiện tại — sau repair và model-budget review

- Yêu cầu còn mở: áp budget an toàn, nghiệm thu runtime/health rồi push GitHub; người dùng đã chọn sửa budget trước push, cho phép tham khảo nguồn và không cần đo model.
- Đã hoàn tất 16 commit sửa logic, mới nhất `b09ebc7` (budget), trên `master`; chưa push. Không còn source edits đang chạy. Tất cả required reviewer đã trả kết quả.
- Full regression cuối: 52 Node files, **639 pass / 0 fail/cancel/skip**, exit 0; Python **53 pass** (16 + 17 + 4 + 11 + 5), exit 0. [Log Node](</tmp/dsh-audit-budget-node-final.log>).
- [Nguồn budget](<docs/aegis/work/2026-10-29-dsh-audit/budget-sources.md>) đối chiếu per-route local catalog/adapter/cache, không inference; unknown model vẫn fail closed; defaults `or`/`cgw` 128000/16384 không đổi. Không coi fallback UI là upstream proof.
- Preview RAM của live profile: 19 `or` + 6 `cgw`, sau repair 0 budget errors, routing/model IDs không đổi; live bytes không bị ghi. **Chưa áp live** vì GUI/profile writers đang chạy và repair guard yêu cầu dừng thật.
- [Health thụ động mới nhất](</tmp/dsh-audit-budget-health.log>): **41 đạt, 1 lỗi, 2 bỏ qua**, exit 1; còn profile budget chưa áp. Runtime modules/overload trên đĩa chưa được chứng minh đã reload.
- Cleanup đã xóa đúng 5 artifact regular/untracked đã kiểm chứng, tổng 262964 bytes; giữ sessions/memory/credentials/source/backups/cache và PID/log không rõ identity. Không chạy cleaner live.
- [Báo cáo đầy đủ](<docs/aegis/work/2026-10-29-dsh-audit/report.md>) ghi scope/residual/process noncompliance. Các ghi chú bên dưới là lịch sử baseline, không phải việc cần chạy lại từ đầu.

## Yêu cầu và giới hạn

- Kiểm tra hệ DSH tại máy này, sửa lỗi có bằng chứng, regression, dọn rác an toàn, commit từng thay đổi logic và push bình thường lên origin đã xác minh.
- Repo: `deepseek-harness-workspace`, branch `master`, baseline `af834ed4bb47ce7ed4bf113c16cc8d5b39597733`.
- Runtime: DSH `0.2.1-rc.2` bản cài npm, không có Git/source checkout. GUI hiện hữu `http://127.0.0.1:3080`; không thay server hoặc restart phiên đang chạy.
- Không xóa dữ liệu/session/memory/credential, không force push, không commit thay đổi người dùng, không áp candidate compression thử nghiệm vào runtime.
- Hindsight search tool không được đăng ký trong phiên; discovery không tìm thấy. Không thay bằng HTTP/CLI hay hệ memory khác.

## Phạm vi và tiêu chí

- Guard plugins, maintenance/integration tools, manifest và bề mặt runtime đã cài; quét secret trên tracked files mà không ghi giá trị.
- Baseline health + toàn bộ Node/Python tests tracked; sửa bug theo `TDD Route: strict` (test đỏ trước sửa), chạy lại toàn bộ suite.
- Browser smoke thật desktop/mobile nếu browser hoạt động; không gửi prompt tính phí hoặc tạo dữ liệu thật.
- Chỉ dọn artifact tái tạo đã kiểm chứng; giữ nguyên thư mục dữ liệu và công việc không rõ nguồn.
- Push chỉ sau kiểm tra diff, secret, regression và remote/branch.

## Lịch sử baseline và tiến độ trước các commit

- Git tracked sạch; untracked ban đầu `.cache/`, `.probe/`, `.tmp-install/`, `output/`; `.cache/` khoảng 2.1 GiB, chưa xóa.
- Node: 45 test files, 493 tests, 471 pass, 22 fail, exit 1. Log `/tmp/dsh-audit-20261029-node-baseline.log`.
- Fail: overload classifier regression 4 tests; candidate compression pinned source drift (runtime billion-context 0.1.209/39a0ada5 thay vì 0.1.204), SHA256 mismatch và `ReferenceError: yieldToEventLoop is not defined`.
- Python: 11 + 17 + 4 = 32 tests pass, exit 0.
- Health: 42 đạt, 1 lỗi, 0 bỏ qua, exit 1. Log `/tmp/dsh-audit-20261029-health-baseline.log`; profile budget/unknown new model diagnostics cần đối chiếu trước khi chỉnh; không đoán giới hạn provider.
- Audit guard/tools/runtime đã bàn giao. Core chỉ có compiled dist, không có source/tests/maps; chưa thể chứng nhận toàn bộ core. Loopback auth/origin probes trả 401/403 đúng kỳ vọng; secret scan tracked/history chưa thấy high-confidence match (có binary không quét).
- Các lát GREEN riêng: eval host arguments 25/25; tool-filter 11/11; cost status 21/21; cleanup EOF/decoder 22/22 (đang bổ sung symlink guard); publication ignore 3/3. Chưa full regression/review/commit.
- Overload: đã áp đúng patch hiện hữu vào installed dsh-llm-pi-ai; 14/14 pass, không restart nên process hiện tại chưa chắc nạp sửa. Backup `/tmp/dsh-audit-piai-before-hymQ4e.js`; updater persistence đang sửa.
- Health baseline ban đầu đã gọi dump-config và Hindsight functional probe; KHÔNG được gọi đó là hoàn toàn read-only/no-model. Đang sửa passive default, chỉ explicit flags mới refresh hoặc functional. Model budget cũ/unknown IDs giữ nguyên, không đoán upstream limit.
- Các lỗi đang sửa song song theo scope riêng: shim request/stream boundary; compression fixture .204 đúng hash/license; vibe Git/verification classifier + append contract; PID/revert/readiness/update scripts; cleanup symlink.
- `.cache/` chứa cả source/backups/research: KHÔNG xóa wholesale. Chưa cleanup dữ liệu thật. Git publication chỉ ignore local scratch/credential names; không chứng minh có secret đã lộ.
- Lỗi quy trình: nhiều tool call truyền sandbox_permissions dù user cấm; không approval hay widening được cấp. Không coi đây là lý do được tiếp tục dùng field; source edits ưu tiên CAS không có field này.

## Bước tiếp theo

1. Phối hợp cửa sổ dừng/restart DSH với người dùng; không tự ngắt phiên hiện tại hoặc khai sai writer-stopped.
2. Chỉ khi mọi DSH/GUI/profile writer đã dừng thật, chạy `bash tools/fix-cordis-budgets.sh --writer-stopped` từ workspace. Tool đọc policy mới, backup và chỉ sửa budget model hiện có; không sửa routing/credential. Không truyền flag này khi GUI còn hoạt động.
3. Khởi động lại đúng GUI hiện hữu, tiếp tục goal/session; chạy health thụ động và kiểm tra module/budget đã nạp, báo thẳng phần chưa verify. Không gọi functional LLM hoặc inference để đo capacity.
4. Khi nghiệm thu đạt, rà soát final Git status/remote và push bình thường `master` lên origin đã xác minh; không force/reset/clean. Ghi receipt remote SHA và cập nhật báo cáo/goal theo kết quả thật.
