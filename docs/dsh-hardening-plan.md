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

## Nghiệm thu và rollback

Mỗi lát: focused tests → toàn bộ `node --test test/`, Python health tests, hai plugin tests khi cần → diff check → commit. Cuối: health static/endpoint, live synthetic task biệt lập và kiểm tra worktree. Chưa chạy được phải ghi chưa verify.

Rollback code bằng `git revert <commit>` theo thứ tự ngược (không reset hard). Rollback profile: sao lưu bản hiện tại trước, khôi phục `web-cordis.patch.yml` từ backup và kiểm tra `dsh --profile web --dump-config`; người dùng restart DSH khi thuận tiện. Backup không chứa database, không phải backup toàn hệ. Không tự chạy rollback làm mất sửa đổi người dùng.
