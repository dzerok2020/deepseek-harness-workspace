---
name: four-phase-implement
description: "Pha 4 产品实现 (triển khai từ tài liệu) của quy trình 4 pha: AI viết code theo docs/product-plan.md + docs/tech-plan.md, mỗi lát commit+test, xuất verification report, chạy app thật → bắt lỗi thật → sửa → lặp, và người kiểm tra là cổng cuối. Dùng khi hai bản plan đã duyệt và bắt đầu code, khi user nói 'triển khai', 'viết code theo docs', '产品实现', hoặc khi báo cáo nghiệm thu code cần format chuẩn."
---

# Pha 4 — 产品实现: code theo hai tài liệu, nghiệm thu bằng chạy thật

Bài học video: "có hai tài liệu này rồi, để Codex triển khai toàn bộ" → một phát ra app hoàn chỉnh *trên giấy*, nhưng vừa chạy `npm start` đã báo lỗi "操作失败，请稍后重试"; quay lại đưa log cho Codex sửa mới chạy được. Hai chế độ làm việc: (a) giao AI việc lớn nền độc lập rồi nghiệm thu, (b) việc phức tạp/tối quan trọng thì người quyết, AI soạn — mức giao nhiều hay ít theo ** độ phức tạp × tầm quan trọng ** ("由浅入深，复杂度和重要性来判断").

## Vòng lặp từng lát (slice)

1. Điều kiện vào lát: `git status` sạch, lát này nằm trong *In scope*, input = `docs/product-plan.md` + `docs/tech-plan.md` + `AGENTS.md`.
2. Code: bản thân session hoặc delegate (subagent/teammate/conductor_dispatch) với prompt trỏ nguyên văn hai docs. Việc nền, đã có plan rõ → delegate trọn gói; kiến trúc/tiền/bảo mật → người giữ quyết định.
3. Kiểm chứng máy móc trước commit: test từng bộ + lint + build (luật AGENTS.md). Fail → sửa trong lát, không commit vàng.
4. **Verification report** (format video, đưa vào commit message / report file):
   ```markdown
   ## Verification Report — <lát>
   | Hạng mục            | Kết quả                          |
   |---------------------|----------------------------------|
   | Unit tests          | 15/15 pass                       |
   | Test module         | 8/8 pass                         |
   | ESLint              | 0 vấn đề                         |
   | Build               | thành công (dev/prod)            |
   | Package             | .dmg/… ra file, OK               |
   | E2E (Playwright…)   | 3/3 (mở app, thêm file, xóa file)|
   | Audit bảo mật       | 0 high/critical                  |
   | Commit              | c6447b6, 35 files, +1595 -0      |
   ```
5. **Chạy thật**: launch app/CLI; lỗi runtime thật (kể cả warning lặp lại như configLoader trong video) → ghi nguyên văn log → đưa AI sửa → chạy lại. Lặp tới khi đạt "chạy được thật".
6. **人工验证 — cổng cuối:** user tự mở và thao tác happy path (video: đọc một file TXT thật, tiến độ hiển thị). User duyệt mới đóng lát.

## Sau các lát

- Gom các tính năng phụ: mỗi phụ một lát nhỏ, hoặc để v2 (Out of scope của pha 2 là danh sách đó).
- Tổng kết: diff toàn trình + báo cáo cuối (theo format trên, cộng screenshot/ảnh chụp màn hình bằng chứng).

## Chống chỉ định

- Code khi thiếu một trong hai docs — AI "dễ tự sinh bug ra" và không nghiệm thu được.
- Tin kết quả vì "tests pass": báo cáo đẹp + app mở ra chết là kịch bản có thật trong video; chạy thật là bắt buộc.
- Đổ lỗi cho AI suông: đưa đúng log + đúng docs, yêu cầu sửa tái hiện được.
- Delegate việc kiến trúc mà không kèm tài liệu: context mất = code lệch plan.
