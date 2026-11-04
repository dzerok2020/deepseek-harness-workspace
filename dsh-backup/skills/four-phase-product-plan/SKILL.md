---
name: four-phase-product-plan
description: "Pha 2 产品方案 (lên phương án sản phẩm) của quy trình 4 pha: liệt kê yêu cầu, cắt scope xuống MVP, làm demo/mockup kiểm chứng trải nghiệm, viết docs/product-plan.md. Dùng khi người dùng mô tả ý tưởng app/tính năng cần chốt 'làm cái gì / không làm gì', nói 'lên phương án sản phẩm', '产品方案', 'chốt scope', hoặc khi repo đã có AGENTS.md nhưng chưa có product plan."
---

# Pha 2 — 产品方案: chốt phạm vi bằng tài liệu + demo

Bài học video: ý tưởng ban đầu đầy ắp tính năng (TXT/EPUB/PDF/TXT、目录/收藏/书签/笔记、主题、字号行距、进度统计、全文搜索、导出笔记), nhưng khi triển khai phải **cắt xuống lát nhỏ**: "只保留最基础的功能...支持 TXT 文件的阅读...去掉章节跳转...先做一个简易 Demo" — rồi làm demo để kiểm chứng trước khi code thật.

## Các bước

1. **Trải khai yêu cầu.** Liệt kê toàn bộ tính năng người dùng muốn + các đề xuất mở rộng AI thấy hợp lý (nhãn rõ: mong muốn vs đề xuất). Ghi từng mục.
2. **Cắt scope (bắt buộc).** Chọn lát nhỏ nhất có giá trị dùng thật:
   - Ưu tiên một loại dữ liệu/happy path duy nhất; các dạng input khác → "không làm" có ghi chú.
   - Tính năng "có thì đẹp" (sync, thống kê, xuất file, cài đặt sâu) → đưa vào cột *Out of scope / v2*.
   - Bảng hai cột *In scope / Out of scope* phải có trong tài liệu.
3. **Demo kiểm chứng.** Làm mockup rẻ nhất có thể trả lời "dùng thế đã đúng ý chưa": HTML tĩnh / ảnh dựng từ chính skill này, hoặc màn hình thật của app mẫu. Đưa user xem, ghi nhận chỉnh sửa. Demo không phải sản phẩm.
4. **Viết `docs/product-plan.md`** với khung:
   ```markdown
   # Product Plan — <tên>
   ## Mục tiêu & người dùng
   ## In scope (MVP)          # ← từng tính năng验收 được
   ## Out of scope / v2       # ← kèm lý do cắt
   ## Luồng màn hình / trải nghiệm
   ## Tiêu chí chấp nhận       # ← check nghiệm thu từng mục
   ## Rủi ro & câu hỏi mở
   ```
5. **Commit** (`docs: product plan`) — theo luật commit của AGENTS.md (docs không cần test, nhưng phải commit riêng).
6. **Gate:** người dùng duyệt bản kế hoạch + danh sách cắt giảm. Chỉ sang `four-phase-tech-plan` khi gate mở.

## Chống chỉ định

- Xuôi theo mọi đề xuất của AI mà không cắt: scope phình = pha 4 không xong.
- Nhảy sang chọn stack công nghệ trong pha này — công nghệ là pha 3, ở đây chỉ chốt "cái gì".
- Demo tốn hơn code thật: demo vượt quá ~15 phút dựng là dấu hiệu làm quá.
