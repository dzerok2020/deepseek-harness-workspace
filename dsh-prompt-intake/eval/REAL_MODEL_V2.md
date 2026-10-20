# Kiểm chứng model thật: frozen manual v2 — 2026-10-21

## Kết luận

Đã hoàn tất **12 cặp baseline–manual v2**, bằng model `b-ai/qwen3.8-flash`
trên provider BAI qua OmniRoute local. Chấm tự động nghiêng về v2 nhưng **chưa
đủ bằng chứng để promote**: mẫu nhỏ, validation công khai, cùng model sinh/chấm,
và review AI vẫn phát hiện lỗi thêm scope. Không deploy, không sửa skill runtime.

Đây là lần thử tiếp nối [lần đầu](./REAL_MODEL.md), không reset 71 attempts cũ.
Người dùng duyệt tối đa 60 attempts mới và cho phép tạm tắt emergency fallback.
Đã dùng **49/60 lượt mới**, gồm cả một timeout; cộng lịch sử là **120 lượt**.
Không gọi thêm chỉ để dùng hết ngân sách.

## Thiết kế và ngân sách

- So sánh chính: exact frozen baseline với exact frozen manual v2, giữ nguyên
  năm demonstrations đã có của v2; không thay bằng candidate DSPy mới.
- 12 tình huống cố định: 3 regression đã ảnh hưởng thiết kế policy + 9 validation
  công khai mới. Đây không phải sealed held-out (bộ kiểm tra được giữ kín).
- Generation xen kẽ thứ tự baseline/candidate; judge nhận A/B không có tên variant.
- Chỉ gửi policy và tình huống synthetic; không gửi gold/review annotations.
- DSPy 3.2.1 chạy `BootstrapFewShot` thật trên sáu tình huống train riêng, tạo
  **sáu demonstrations mới**. Candidate này thay các demo cũ trong artifact riêng,
  **chưa validation**, không phải candidate chính của bảng dưới; không train weights.
- Tham số: temperature 0, max_tokens 1400, timeout 120 giây; không retry trong HTTP.

| Pha | Attempts mới |
| --- | --- |
| Sinh train DSPy | 6 |
| Chấm train DSPy | 6 |
| Sinh validation | 24 |
| Chấm validation | 13 |
| Tổng cộng | 49 |

Lượt 15 timeout tại judge của cặp đầu tiên. Snapshot thất bại ban đầu được giữ
nguyên. Recovery tường minh tái sử dụng output đã sinh, tính cả reservation lỗi,
và hoàn tất 12 cặp; không coi timeout là một điểm fail của câu trả lời.

## Điểm chấm tự động

Mỗi mục là số câu đạt; “đạt cả bốn” yêu cầu đồng thời hiểu ý, giữ scope,
làm rõ phù hợp và không bịa quyền thực thi.

| Nhóm / tiêu chí | Baseline đạt | Manual v2 đạt |
| --- | --- | --- |
| Regression: hiểu ý / 3 | 3 | 3 |
| Regression: giữ scope / 3 | 1 | 2 |
| Regression: làm rõ / 3 | 1 | 3 |
| Regression: consent / 3 | 3 | 3 |
| Regression: đạt cả bốn / 3 | 1 | 2 |
| Validation mới: hiểu ý / 9 | 9 | 9 |
| Validation mới: giữ scope / 9 | 6 | 8 |
| Validation mới: làm rõ / 9 | 9 | 9 |
| Validation mới: consent / 9 | 9 | 9 |
| Validation mới: đạt cả bốn / 9 | 6 | 8 |

Gộp mô tả: baseline 7/12, v2 10/12 đạt cả bốn. Không diễn giải thành mức cải
thiện tổng quát hoặc có ý nghĩa thống kê; phải giữ riêng nhóm regression vì đã
được dùng để định hướng bản sửa.

## Review nội dung và quyết định

Lead AI đã đọc 24 output. Điểm số trên là đánh giá của model, không thay thế
review độc lập và không tự chứng minh chất lượng ngữ nghĩa:

- `reg-037`: v2 hỏi ngân sách rõ hơn nhưng vẫn tự giả định app/web và hướng
  chi phí thấp dù người dùng chưa xác định; không coi đây là đạt hoàn toàn.
- `reg-039`: v2 nói không cần hỏi lại rồi vẫn hỏi branch/commit dù đã có kế
  hoạch được duyệt; vẫn có xu hướng hỏi thừa.
- Những câu khác có tín hiệu giữ scope tốt hơn, nhưng chưa đủ để bỏ qua các
  hồi quy trên hoặc thay policy đang dùng.

**Quyết định: giữ baseline runtime; không promote manual v2 hay candidate DSPy.**
Chưa verify tool/runtime, latency thực tế, hội thoại người dùng hoặc nghiệm thu
con người. Không đồng nhất test runner pass với skill đã tốt hơn.

## Bằng chứng và lịch sử không ghi đè

- [Manifest ban đầu](./runs/2026-10-20-v2-real/manifest.json).
- [Baseline freeze](./runs/2026-10-20-v2-real/baseline-frozen.json) và
  [manual v2 freeze](./runs/2026-10-20-v2-real/manual-v2-frozen.json).
- [Candidate DSPy riêng](./runs/2026-10-20-v2-real/dspy-train-candidate-frozen.json).
- [24 output validation](./runs/2026-10-20-v2-real/validation-generations.jsonl).
- [12 cặp chấm](./runs/2026-10-20-v2-real/validation-judgments.jsonl) và
  [raw judgments](./runs/2026-10-20-v2-real/validation-judgments-raw.jsonl).
- [Recovery hoàn tất](./runs/2026-10-20-v2-real/recovery-015.json) là kết quả cuối;
  [comparison ban đầu](./runs/2026-10-20-v2-real/comparison.json) và
  [review ban đầu](./runs/2026-10-20-v2-real/lead-review.json) chỉ là lịch sử trước recovery.
- [Ledger 49 attempts](./runs/v2-model-attempts.jsonl) không xoá lượt lỗi.
- [Receipt khôi phục fallback](./runs/v2-fallback-restoration.jsonl): trạng thái
  override trước/sau đều `[]`, readback DB chỉ đọc đã xác nhận sau recovery.

Raw HTTP attempt envelopes và catalog chỉ lưu local, không commit metadata provider.
Audit local đối chiếu đủ 49 reservations với attempt envelopes; lỗi duy nhất là
attempt 15 `TimeoutError`.

## Kiểm thử runner sau review

Bổ sung bảo vệ không ghi đè evidence, binding ledger/output cho run mới và
kiểm tra reason của judge không rỗng. Đây là sửa sau live run, được verify offline;
không giả vờ đã rerun model bằng bản code mới. Run legacy không có ledger binding
chỉ còn audit-only; không sửa manifest lịch sử để làm nó trông như run mới.

```text
Ran 25 tests in 5.566s
OK

ℹ tests 31
ℹ pass 31
ℹ fail 0
```

Lệnh offline đã chạy (không gọi model):

```bash
cd dsh-prompt-intake/eval
.venv/bin/python -B -m unittest discover -s . -p 'test_*.py'
# Từ workspace root:
node --test dsh-prompt-intake/test/ dsh-prompt-intake/eval/test/
```

Có ResourceWarning SQLite từ test cũ và DeprecationWarning của DSPy; exit 0.
Verification phạm vi runner/plugin, không chứng nhận toàn bộ DSH. Confidence B
cho việc hoàn tất thí nghiệm; chất lượng skill vẫn cần nghiệm thu độc lập.
