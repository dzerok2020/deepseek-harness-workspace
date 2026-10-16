# Product Plan — DSH C2C control adapter

## Mục tiêu và quyết định

Người dùng yêu cầu DSH tự chạy ChatGPT PLAN → DSH thực thi/test → ChatGPT REVIEW, không BrowserSkill. Đã chọn phương án A: cửa sổ Chromium riêng do DSH quản lý, profile riêng; đây là DSH adaptation, không phải Codex IAB nguyên bản.

## Phạm vi

| In scope | Out of scope / v2 |
| --- | --- |
| Native DSH tools quản lý Chromium có cửa sổ/profile riêng | Sao chép private Codex browser runtime |
| Giữ C2C MCP read-only và thông điệp dưới 1 KB | Thay provider DSH, gọi API ChatGPT riêng tư |
| INIT/PLAN/EXECUTED/REVIEW/DONE với task/iteration | Nhiều workspace, account rotation |
| Checkpoint và kiểm tra lịch sử trước retry gửi | Tự vượt CAPTCHA/2FA/quota hoặc đăng nhập hộ |
| DSH sửa/test, xuất receipt thật; ChatGPT đọc qua MCP | Gửi code/diff/log trực tiếp vào chat |
| Pause rõ cho login, connector consent, lỗi/quota | Bảo đảm tiết kiệm token hoặc chạy unattended vô điều kiện |

## Luồng và demo kiến trúc

DSH native tools → adapter → Chromium riêng → ChatGPT.

ChatGPT → OAuth MCP upstream → workspace đã cho phép + execution receipts.

PLAN và REVIEW quay lại DSH; được coi là nội dung không đáng tin cậy, không cấp quyền thực thi lệnh tùy ý. Browser không expose cookie, token, storage, request interception hoặc JavaScript tùy ý cho model.

## Tiêu chí chấp nhận

- Unit tests cho wire format, matching task/iteration, checkpoint, duplicate-send ambiguity và giới hạn URL.
- Browser smoke test bằng trang cục bộ; shutdown chỉ đóng process/profile sở hữu.
- Đăng nhập trực tiếp bởi người dùng trong profile riêng; không import cookie/profile thật.
- Chỉ workspace mẫu được đồng ý chia sẻ, nonce đọc qua MCP chứng minh đúng workspace.
- INIT → PLAN → thay đổi và test thật → EXECUTED → ChatGPT đọc diff/output qua MCP → REVIEW/DONE.
- Resume không tự gửi lại thông điệp chưa xác định kết quả; quota/auth/CAPTCHA phải pause.
- Thu hồi OAuth chặn đọc; dừng tunnel khi nghiệm thu xong.

## Rủi ro và cổng nghiệm thu

DOM ChatGPT thay đổi; subscription và quyền connector có thể chặn. Login/CAPTCHA/2FA và cấp quyền là thao tác của người dùng. Cài đặt, unit tests, browser smoke, OAuth/MCP và E2E là các trạng thái riêng; chưa chạy thì ghi chưa verify.
