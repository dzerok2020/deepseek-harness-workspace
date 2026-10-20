# Thử nghiệm model thật và DSPy — 2026-10-20

## Kết quả thực tế

- Model được duyệt: `b-ai/qwen3.8-flash/BAI` trên OmniRoute local.
  `BAI` là nhãn provider; ID gọi API đã kiểm chứng là `b-ai/qwen3.8-flash`.
- Đã dùng **71/100 attempts**, tính cả lượt timeout; không retry tự động.
- DSPy **3.2.1**, optimizer thật `dspy.BootstrapFewShot`: 6 lượt sinh train,
  6 lượt chấm train, chọn **5 demonstrations**. Đây là chọn ví dụ few-shot,
  không huấn luyện weights và không tự viết lại toàn bộ policy.
- Sinh đủ **20 baseline + 20 candidate** trên held-out synthetic tiếng Việt.
  Candidate được freeze trước held-out; không đưa expected/gold vào input.
- Chấm tự động hoàn tất **8/20 cặp**. Lượt thứ 9 lỗi `TimeoutError: timed out`
  ở `Transport.call`, timeout 75 giây; job exit **1**. Không giả vờ đây là
  một run hoàn tất và không suy điểm 8 cặp thành điểm của cả 20 cặp.
- Review trực tiếp bởi Lead AI đủ 20 cặp: có cải thiện ở một số câu mơ hồ,
  nhưng hồi quy vi-037, vi-039 và vẫn thêm scope vi-041. **Không promote.**
- Không đổi adapter, skill runtime hay model đang phục vụ chat; không deploy.

## Bằng chứng

Trong [thư mục kết quả](./runs/2026-10-20-real/):

- [Manifest](./runs/2026-10-20-real/manifest.json): version, tham số, hash policy/dataset.
- [Policy baseline](./runs/2026-10-20-real/baseline-policy.json).
- [Candidate đã freeze](./runs/2026-10-20-real/candidate-frozen.json).
- [20 cặp output thật](./runs/2026-10-20-real/heldout-raw.json).
- [8 cặp chấm hoàn tất](./runs/2026-10-20-real/heldout-judgments.json).
- [Review trực tiếp 20 cặp](./runs/2026-10-20-real/lead-review.md).
- [Báo cáo partial](./runs/2026-10-20-real/comparison-partial.json).
- [Ledger 71 attempts](./runs/real-model-attempts.jsonl), reserve trước HTTP,
  lock + fsync; thất bại vẫn tính ngân sách.

## Điểm chấm tự động — chỉ 8 cặp đầu

| Tiêu chí | Baseline đạt / 8 | Candidate đạt / 8 |
| --- | --- | --- |
| Hiểu ý / giữ context | 8 | 8 |
| Không tự thêm scope / facts | 7 | 7 |
| Làm rõ phù hợp | 8 | 8 |
| Không bịa quyền thực thi | 8 | 8 |
| Đạt cả bốn | 7 | 7 |

Cùng model vừa sinh vừa chấm nên có bias tương quan. Review Lead khác với
judge ở một số điểm; không chọn một điểm số đẹp để che hồi quy. Đây không
phải bằng chứng cải thiện có ý nghĩa thống kê hay nghiệm thu của người dùng.
`semanticQualityVerified` vẫn false, dù đã có output model thật và review AI.

## An toàn routing và dữ liệu

Chỉ gửi scenario synthetic và policy intake, không gửi lịch sử chat riêng tư.
Preflight xác minh provider BAI/prefix b-ai, một connection main active và
catalog có model canonical. OmniRoute mặc định có emergency fallback sang
provider khác; sau khi được người dùng duyệt, tạm đặt DB feature flag false,
chờ cache hết hạn và kiểm tra trước mỗi call. Wrapper `finally` đã xoá override
để khôi phục đúng trạng thái trước đó (override không tồn tại), kể cả khi run
bị timeout. Readback sau run: `[]`. Không đổi provider credentials.

Runner không tự tắt fallback hay tự retry. Không chạy lại `--execute` sau run
này: ledger có attempts sẽ chặn để tránh ghi đè và tiêu thêm ngân sách.
Raw attempt files chỉ phục vụ audit local, không đưa vào Git vì có metadata
provider. Các output tổng hợp chỉ chứa dữ liệu synthetic đã review.

## Kiểm chứng và giới hạn

Kiểm thử offline runner bao phủ budget, tính cả failure, không retry, không
lộ gold fields và routing fail-closed. Chạy không gọi model:

```bash
python3 -B -m unittest discover -s dsh-prompt-intake/eval -p 'test_real_eval.py'
node --test dsh-prompt-intake/test/ dsh-prompt-intake/eval/test/
```

Chưa verify hành vi tool thật, browser, latency runtime hoặc chất lượng trên
hội thoại riêng tư. Baseline là nội dung skill prompt-intake cùng hướng dẫn
offline, không phải toàn bộ system prompt DSH. Held-out công khai, chỉ 20 mẫu;
review Lead không thay nghiệm thu độc lập của con người. Phần chấm tự động
còn thiếu 12 cặp. Không chạy thêm chỉ để dùng hết ngân sách; cần một quyết
định rõ ràng về tiếp tục chấm hoặc sửa candidate trước lần thử tiếp theo.
