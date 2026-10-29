# Kế hoạch tăng độ tin cậy DSH — 2026-10-17

## Mục tiêu và phạm vi

Theo yêu cầu người dùng: thu hẹp quyền nguy hiểm → thống nhất context → nâng chất lượng health check → tinh gọn từng lớp bằng số liệu. Không nâng phiên bản hàng loạt, xóa bộ nhớ hay restart phiên đang làm việc. Thực hiện inline, từng lát có commit và rollback.

## Baseline và kiến trúc

- Workspace HEAD trước thay đổi: `fd142dd` (worktree sạch).
- Cấu hình live: `/home/dzerok/.dsh/profiles/web/cordis.patch.yml`; overlay pipeline: `tools/vibe-native.yml`, `tools/vibe-cgw.yml`; điều phối: `tools/dsh-vibe-run.mjs`.
- Quyền thuộc `sandbox-policy`, `approval`, `permission`, không thuộc `agent-default-model` (schema chỉ provider/model/reasoningEffort).
- DSH 0.2.0-rc.2, Node 26.8.2, YAML overlay + Node tests + Python health checker + Bash entry point.
- Backup riêng tư: `/home/dzerok/.dsh/backups/hardening-20261017-1245/` gồm profile patch, package, lockfile, phiên bản và HEAD. Không chép secrets vào repo.

## Quyết định và ranh giới

Change Necessity: config-only cho mặc định web/context; code-change tối thiểu ở nơi sinh overlay quyền và bộ kiểm tra health. Chỉ sửa tài liệu không thể kiểm soát quyền runtime hoặc phát hiện lỗi chức năng.

TDD Route: strict cho sửa hành vi pipeline (luật dự án: test đỏ trước); regression cho cấu hình và test âm tính cho health. Không thêm fallback hay sửa mã DSH upstream. Sửa tại owner hiện có; helper mới chỉ khi phân tầng health cần kiểm thử độc lập.

Giữ nguyên model, provider, đăng nhập và dữ liệu. Giới hạn context là ngân sách vận hành bảo thủ, không tuyên bố là giới hạn upstream đã đo. Cấu hình web mới áp dụng cho tiến trình/phiên mới; không tuyên bố thu hẹp phiên hiện tại. Các preset nguy hiểm vẫn là lựa chọn explicit, không là mặc định.

## Các lát và tiêu chí

1. Quyền: web mặc định workspace-write + ask; pipeline workspace-write + never (headless không thể hỏi), fallback Architect/Reviewer read-only. Pin đúng sandbox-policy/approval/permission. Test overlay thực tế; probe sandbox trong repo tạm: ghi trong repo thành công, ngoài repo bị chặn. Commit riêng.
2. Context: thống nhất route `or` và `cgw` cùng ngân sách 128000 context / 16384 output trên model entries và defaults ở profile/overlay. Explicit entries để tránh registry override. Kiểm tra dump config và regression; giữ khả năng rollback profile độc lập. Commit riêng.
3. Health: phân biệt static, endpoint, chức năng và live opt-in; timeout hữu hạn, không gọi LLM ngầm ở kiểm tra thường. Thêm kiểm tra quyền/context và chuỗi bridge; test lỗi endpoint/malformed/model mismatch, không coi HTTP 200 là chức năng thành công. Commit riêng.
4. Đo rồi tinh gọn: thu thập snapshot RAM/service và số bundle/route; loại khai báo trùng đã chứng minh thuộc repo, không tắt plugin memory chỉ vì cùng loại. Ghi rõ dữ liệu chưa đủ để quyết định tắt lớp; không hứa cải thiện tốc độ nếu chưa đo A/B.

## Cập nhật policy theo model — 2026-10-29

Phần này thay thế quy tắc **mọi model cùng 128000** của lát 2 ở trên; bảng trạng thái ngày 17/10 bên dưới là lịch sử, không phải policy hiện hành.

- Nguồn policy vận hành mong muốn duy nhất là [web-model-budgets.yml](<../tools/web-model-budgets.yml>), khóa theo provider + model; defaults vẫn là `128000/16384`. Các giá trị `or` xuất phát từ catalog được báo cáo ngày 25/10, **không phải chứng nhận request dài đã được upstream chấp nhận**. `cgw` giữ ngân sách bảo thủ `128000/16384`.
- [Helper ngân sách](<../tools/model_budgets.py>) dùng PyYAML (máy hiện có `6.0.3`) cho health và repair, thay numeric allowlist và parser indentation. Model không biết, model trùng hoặc YAML mơ hồ phải báo lỗi, không suy đoán từ model khác. Model bị thiếu khỏi profile không được tự thêm hay xóa; overlay không chứng minh profile đã được áp dụng.
- [Entrypoint repair](<../tools/fix-cordis-budgets.sh>) chỉ sửa budget của model/provider đã biết, giữ model 1M hợp lệ và phần cấu hình khác; backup giữ nguyên bytes và LF/CRLF, không tạo backup nếu đã sạch hoặc từ chối ghi. Unknown/malformed làm repair dừng trước khi ghi; mixed newline bị từ chối. Không ghi lại cả YAML để tránh đổi comment/credential/phần không liên quan.
- Trước khi repair có ghi: **dừng DSH/GUI và mọi tiến trình có thể lưu profile**, rồi mới xác nhận bằng `bash tools/fix-cordis-budgets.sh --writer-stopped`. Công cụ không tự dừng/restart hệ thống; thiếu xác nhận sẽ từ chối ghi. Advisory file lock chỉ chặn repair cùng công cụ, không chặn GUI; kiểm tra inode/bytes và atomic rename **không phải compare-and-swap**, nên không an toàn nếu writer khác vẫn hoạt động.
- Runtime adapter đã cài ưu tiên `entry.contextWindow`, rồi registry của model, rồi provider default; vì vậy default 128K không giới hạn entry 1M. Ngưỡng nén context là hành vi DSH, không chứng minh upstream cho phép cùng kích thước.
- Các test âm tính phải gồm đổi chéo ngân sách giữa model, default sai, unknown, cgw 1M, và repair giữ nguyên model 1M hợp lệ. Repair được kiểm trên profile giả; không tự áp dụng vào profile live hoặc restart DSH.

## Nghiệm thu và rollback

Mỗi lát: focused tests → toàn bộ `node --test test/`, Python health tests, hai plugin tests khi cần → diff check → commit. Cuối: health static/endpoint, live synthetic task biệt lập và kiểm tra worktree. Chưa chạy được phải ghi chưa verify.

Rollback code bằng `git revert <commit>` theo thứ tự ngược (không reset hard). Rollback profile: sao lưu bản hiện tại trước, khôi phục `web-cordis.patch.yml` từ backup và kiểm tra `dsh --profile web --dump-config`; người dùng restart DSH khi thuận tiện. Backup không chứa database, không phải backup toàn hệ. Không tự chạy rollback làm mất sửa đổi người dùng.

## Trạng thái triển khai (2026-10-17)

| Lát | Commit / tệp | Bằng chứng |
|---|---|---|
| 1. Quyền | `d6f88f2` (tools/dsh-vibe-run.mjs pin sandbox-policy/approval/permission; test owner-pin) + profile live `defaultPreset: workspace-write` (không thuộc git; backup `~/.dsh/backups/hardening-20261017-1245/web-cordis.patch.yml`) | Test đỏ→xanh (81/81). Probe headless THẬT trong repo tạm (`/tmp/sbx-probe-*`, log `/tmp/sbx-probe-run2.jsonl`): ghi trong repo exit 0; ghi `$HOME` bị chặn `[sandbox: file access denied under workspace-write mode]`, file không tồn tại. Lưu ý: phiên GUI đang chạy vẫn giữ danger-full-access cho tới khi restart — thay đổi chỉ áp dụng cho phiên/s进程 mới. |
| 2. Context | `9b2577d` (vibe-native.yml, vibe-cgw.yml) + profile live cordis.patch.yml | `test/route-budget.test.mjs` đỏ→xanh; mọi model or/cgw khai báo tường minh 128000/16384; `dsh --profile web --dump-config` exit 0 stderr rỗng, `grep` không còn 1000000/131072/384192. **Sự cố trôi (drift) 13:24**: tiến trình GUI ghi đè cordis.patch.yml trả 6 model về 1M/65000/131000 — phát hiện khi đối chiếu đĩa; đã re-unify (12 dòng, backup `web-cordis.before-reunify-133515.yml`) và thêm `check_profile_budgets` vào orchestration-health (đọc file thật, 4 unit test đỏ→xanh; bằng chứng negative: file drift cũ báo đúng 12 LỖI exit 1). Nếu GUI ghi đè lần nữa, `bash tools/dsh-health.sh` mục 12 sẽ báo thay vì âm thầm hỏng. |
| 3. Health | `e05c2a6` (tools/orchestration-health.py + test + dsh-health.sh mục 12) | 5 unit test negative (mode sai, catalog thiếu model, bridge không accepting_turns, endpoint chết) pass; check thật ĐẠT exit 0. HTTP 200 không còn được coi là đủ. |
| 4. Đo rồi tinh gọn | tài liệu này | Baseline mới vs audit sáng: laya-serve 5.202GB→5.202GB, hindsight-daemon 3.846GB→3.694GB, omniroute 1.459→1.471GB, headroom 0.701→0.674GB, shim 32MB, 34 bundles, RAM 22.2/31.9GB. Dao động ±4%, không dấu hiệu leak → KHÔNG tắt/dịch vụ xoá/lớp nào: chưa có bằng chứng trùng đột phá chức năng; các lớp memory (Hindsight/OpenViking/StrataGate/Mnemon) giữ nguyên. vibe-native.yml trông như trùng web profile nhưng headless profile bắt buộc cần overlay riêng → giữ. |

Nghiệm thu tổng: chạy toàn bộ `node --test test/` (83), 2 bộ Python, `bash tools/dsh-health.sh`, và pipeline 4-vai-tò thật task mới (`/tmp/vibe-live2-XXXX`) với pin + budget mới — kết quả ghi trong báo cáo cuối.
