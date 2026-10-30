# Đồng bộ budget từ DSH Settings vào Git

## Một chiều, có chủ ý

- **Settings → Models** là nơi thay đổi cấu hình vận hành. Bấm **Save** trước khi sync.
- [Policy trong Git](../tools/web-model-budgets.yml) là snapshot tham chiếu để health so sánh và lưu lịch sử; không tự điều khiển Settings.
- [Công cụ sync](../tools/sync_model_budgets.py) chỉ đọc profile đã lưu và ghi policy. Không gọi model, không đổi routing, không ghi profile hay restart DSH.
- Không có watcher hoặc hook chạy sau Save. Mỗi lần muốn cập nhật snapshot, chạy preview rồi apply có revision.

## Dùng sau khi sửa Settings

Chạy từ thư mục gốc workspace:

```bash
python3 -B tools/sync_model_budgets.py
```

Đọc `changes`: mỗi dòng có provider, model ID chính xác, tên trường, số cũ và số mới. `model: null` là provider default. Kiểm tra cả **tăng lẫn giảm**; sync không chứng nhận upstream chấp nhận số token đó.

Nếu đúng, lấy nguyên `revision` của preview:

```bash
python3 -B tools/sync_model_budgets.py --apply --expect "<revision-vừa-preview>"
```

Sau apply, chạy lại preview: `changes` phải là `[]`. Sau đó review diff và chạy health:

```bash
git diff -- tools/web-model-budgets.yml
bash tools/dsh-health.sh
```

Preview không ghi file. Apply chỉ thay snapshot tham chiếu. Nếu Settings hoặc policy đổi sau preview, revision cũ bị từ chối; preview lại, không ép ghi. Profile có thể đang chạy vì công cụ này **không ghi profile**.

Mặc định đọc `${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml`. Có thể dùng `--profile <path>` và `--policy <path>` khi kiểm thử hoặc chọn snapshot khác; không trỏ hai đường dẫn tới cùng một file. Nguồn là profile patch đã lưu, không phải bản nháp chưa Save hay bằng chứng cấu hình RAM/upstream.

## Dữ liệu nào được đồng bộ?

- Chỉ provider `or`/`cgw` đã có trong policy; ghép model bằng **ID chính xác**, không dựa vào tên hiển thị hoặc vị trí trong danh sách.
- Chỉ `defaultContextWindow`, `defaultMaxTokens`, `contextWindow`, `maxTokens` cùng provider/model ID. Không xuất URL, API key, tên biến credential, options, display name hoặc payload.
- Model mới được thêm khi có đủ hai budget số nguyên dương đã cấu hình rõ ràng. Không suy từ tên model hay provider default.
- Giữ model/provider tham chiếu không xuất hiện trong profile; sync không xóa hoặc đổi tên model. Provider ngoài phạm vi không được nhập.
- YAML trùng ID/key, budget thiếu/sai kiểu, file symlink/cùng inode, reference chứa trường không thuộc allowlist hoặc thay đổi phát hiện trong lúc apply đều bị từ chối. Lỗi parse không in nội dung cấu hình.
- Giữ comment, newline và mode của reference; tạo candidate đã validate rồi thay file nguyên tử. Revision gắn với nội dung và identity/mode của cả nguồn lẫn đích.

Không sửa Settings/policy đồng thời với apply. Kiểm tra identity trước replace giảm nguy cơ ghi nhầm nhưng không phải filesystem CAS và không khóa được mọi editor bên ngoài; nếu Save xảy ra sau lần đọc cuối, chạy preview lại để bắt lệch.

## Không nhầm với chiều khôi phục

[Công cụ repair cũ](../tools/fix-cordis-budgets.sh) đi chiều **policy → profile** để chủ động khôi phục cấu hình. Nó vẫn yêu cầu dừng mọi DSH/GUI/profile writer trước `--writer-stopped`; sync không gỡ hoặc né guard đó. Không chạy repair chỉ để làm health xanh nếu chủ ý là giữ số vừa sửa trong Settings — hãy review và sync snapshot theo chiều trên.

Policy không còn khớp khi Settings được sửa mà chưa sync là trạng thái cần review, không phải lý do tự rollback. Chỉ commit/push snapshot đã được kiểm tra, không commit profile hoặc credential.

## Sự cố snapshot cũ ngày 2026-10-30

Health đã báo 20 lỗi do reference còn giữ số từ catalog cũ, trong khi Settings đã lưu budget khác và thêm `nr-ai/deepseek-v4-pro-0813`. Đã dùng đúng chiều **Settings → Git**, cập nhật 21 trường budget và giữ nguyên byte của profile đang chạy; không đổi routing, credential, danh sách model, plugin hay restart DSH. Đây là cấu hình vận hành do người dùng lưu, không phải kiểm chứng capacity quảng cáo của upstream.

Regression mới chặn việc lấy lại số catalog cũ để ghi đè chủ ý Settings. Model không còn trong profile vẫn giữ reference lịch sử theo contract sync; các overlay `vibe-native`/`vibe-cgw` opt-in cũng giữ nguyên. Sau lần Save tiếp theo, cần review preview và apply lại nếu muốn cập nhật reference; không có auto-sync và không làm health im lặng trước drift.

Kiểm chứng bản sửa: catalog regression RED **6 tests, 3 failures** → GREEN **6/6**; toàn bộ test root **233 Node + 60 Python pass**, không fail/skip. Health **42 đạt, 0 lỗi, 2 bỏ qua**, exit `0`; log `/tmp/model-policy-health.zBL7XT.log`. Preview sau apply trả `changes: []`; hash profile trước/sau giống nhau. Hai health check bỏ qua không tính pass; không gọi inference để chứng nhận capacity và không đổi contract agents/hooks/MCP.

## Bằng chứng kiểm thử

[Test sync](../test/model-budget-sync.test.py) dùng profile/credential giả và thư mục tạm: RED trước implementation; preview read-only, apply CLI, idempotence, revision stale/metadata, model mới, CRLF/Unicode, malformed YAML, allowlist, symlink/hardlink, thay đổi đồng thời và replace failure. Không dùng inference để đo capacity.
