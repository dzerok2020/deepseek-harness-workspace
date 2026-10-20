# Candidate v2 — chuẩn bị offline

## Phạm vi và trạng thái

Thực hiện phần 1–2 của vòng cải tiến: sửa hướng dẫn candidate và chuẩn bị regression/new validation. Không chạy thêm model hoặc DSPy, không đổi OmniRoute, skill hay plugin runtime. Chưa chứng minh v2 tốt hơn.

- Baseline cố định: policy gốc của lần chạy 2026-10-20, không có demos.
- Candidate v2: policy gốc + policy-addendum, giữ nguyên năm demos DSPy cũ. Đây là chỉnh tay, không phải lần tối ưu DSPy mới.
- Ba regression lấy từ vi-037, vi-039, vi-041 đã được đọc khi sửa policy. Không được tính chúng là held-out độc lập.
- Chín tình huống mới có rubric công khai; cũng không phải tập kín. Trong đó có đối chứng: staging phát sinh phí phải hỏi, consent mơ hồ phải hỏi, BOM được yêu cầu rõ thì phải giữ.
- Tất cả tình huống là dữ liệu tổng hợp; không lấy hội thoại riêng tư.

## Tệp và cách kiểm tra

Manifest lưu SHA-256 của baseline, candidate, addendum và cases. Hàm load_bundle trong prepare_v2.py từ chối artifact sai hash. Hàm messages chỉ đưa id/prompt/context vào request; không đưa rubric hoặc nhãn chấm. Script không có đường gửi network hoặc deploy.

Chạy từ workspace root:

```bash
python3 dsh-prompt-intake/eval/prepare_v2.py
python3 -m unittest discover -s dsh-prompt-intake/eval -p 'test_prepare_v2.py'
```

Hash chỉ giúp phát hiện thay đổi so với manifest, không chứng minh policy tốt, không phải chữ ký chống sửa giả. Test xác nhận integrity và việc không lộ rubric; không chấm được ý nghĩa câu trả lời hay chứng minh model tuân thủ.

## Vòng đánh giá kế tiếp — chưa thực hiện

1. Giữ nguyên artifact và rubric trước khi sinh output; baseline và v2 dùng cùng model/tham số, cùng public input, không cấp tools. Không dùng answers của regression làm demos mới.
2. Sinh hai output mỗi case, lưu nguyên văn với model, tham số, hash và số attempt gồm cả lỗi. Bất kỳ lần gọi nào cũng phải nằm trong ngân sách đã được xác nhận và ledger cũ; chuẩn bị này không cấp thêm ngân sách và không reset 71 attempt đã dùng.
3. Chấm mù theo thứ tự A/B có đối chiếu mapping sau review. Với mỗi must/must_not ghi đạt, không đạt hoặc chưa rõ và trích câu làm bằng chứng. Không mặc định output thiếu/lỗi là đạt.
4. Báo riêng regression và new public validation. Không gộp thành tỷ lệ “chất lượng chung”; phân biệt đề xuất với hành động đã thực hiện. Nếu dùng model tự chấm, vẫn cần review độc lập và nêu thiên lệch.
5. Trước promote cần tập kín do người khác giữ, kiểm thử runtime riêng và người dùng duyệt. Không dùng việc pass unit test hay hash khớp để tự động kích hoạt v2.

Các output thật, so sánh chất lượng v2, tập kín và nghiệm thu runtime đều **chưa verify**.
