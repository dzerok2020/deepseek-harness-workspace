---
name: prompt-intake
description: "Chuẩn hoá prompt mơ hồ, thiếu ngữ cảnh, viết tắt hoặc không dấu trước khi hành động: tự tìm ngữ cảnh trước, nêu giả định, hỏi tối đa 3 câu có phương án chọn, chỉ tự làm phần dễ hoàn tác; chờ xác nhận quyết định có ảnh hưởng lớn. Triggers: vague, ambiguous, not sure, cái này, cái kia, nó, chỗ đó, làm giúp, xem giúp, sửa giúp, bị lỗi rồi, không chạy, ok chưa, tối ưu đi, đẹp hơn, mơ hồ, không rõ ý / hmm, ??, ..."
---

# prompt-intake — hiểu đúng ý trước khi làm

Dùng ở **đầu lượt** khi prompt chưa đủ chắc để hành động. Mục tiêu: **không hỏi thừa, không đoán bừa, không đứng im**.

## 1. Khi nào áp dụng

- Câu rất ngắn hoặc chỉ có cảm xúc: "sửa cái này", "làm sao?", "xem giúp", "ok chưa?", "tối ưu đi", "hỏng rồi".
- Đại từ không có tiền ngữ: "cái này", "cái kia", "nó", "chỗ đó".
- Thiếu một trong năm thứ: mục tiêu, đối tượng (file/app nào), phạm vi, ràng buộc, kết quả mong đợi.
- Trộn nhiều việc trong một câu.
- Viết tắt, không dấu, sai chính tả.

Không áp dụng khi prompt đã rõ, hoặc khi người dùng đang hỏi một câu kiến thức đơn giản.

## 2. Quy trình bốn bước (theo thứ tự)

**Bước 1 — Tự tìm ngữ cảnh trước khi hỏi.** Hỏi là phương án cuối. Đọc tin nhắn trước, file đang được nhắc tới, `git status` / `git diff`, cấu trúc thư mục, README/AGENTS.md, log lỗi gần nhất. Tìm được thì không hỏi.

**Bước 2 — Phân loại mức mơ hồ.**

| Mức | Dấu hiệu | Xử lý |
|---|---|---|
| Rõ | Đủ năm yếu tố | Làm luôn |
| Thiếu nhẹ | Đoán được, sai thì sửa rẻ | Nói một câu giả định rồi **làm luôn** |
| Thiếu nặng | Đoán sai tốn nhiều (sai kiến trúc, xoá nhầm, sai định dạng) | Hỏi tối đa 3 câu, có phương án chọn |
| Mơ hồ hoàn toàn | Không biết muốn gì | Hỏi một câu lớn nhất, đề xuất 2–3 hướng kèm mặc định |

**Bước 3 — Hỏi cho đúng (nếu buộc phải hỏi).** Hỏi tối đa 3 câu, ưu tiên một câu chặn quyết định lớn nhất; có lựa chọn `a` / `b` và đề xuất rõ lý do. Với quyết định về xoá dữ liệu, chi phí, bảo mật, triển khai, API công khai hoặc kiến trúc khó đổi: chờ câu trả lời; im lặng không phải đồng ý. Trong lúc chờ chỉ khảo sát đọc hoặc làm phần độc lập dễ hoàn tác. Không hỏi điều đọc file hay chạy kiểm tra là biết, không hỏi lại điều đã xác nhận.

**Bước 4 — Chốt rồi làm.** Một dòng `Mình hiểu là: <...>` (nêu cả giả định), một dòng đang làm gì, rồi thực thi.

## 3. Quy tắc cứng

1. Chủ động khảo sát phần chỉ đọc và phần độc lập dễ hoàn tác; quyết định ảnh hưởng lớn phải chờ người dùng xác nhận, im lặng không phải đồng ý.
2. Chưa chắc thì chọn phương án **rẻ để sai và dễ sửa**.
3. Trả lời bằng ngôn ngữ của người dùng (gõ tiếng Việt → trả lời tiếng Việt).
4. Hiểu được tiếng Việt không dấu, viết tắt, sai chính tả (`k chay` → "không chạy", `sua giup` → "sửa giúp").
5. Prompt có nhiều việc thì tách ra, nêu thứ tự, rồi xác nhận.
6. Không tự mở rộng phạm vi ngoài điều được hỏi.
7. Người dùng hỏi "ok chưa / xong chưa" thì phải **kiểm tra thật** (test, build, mở file) rồi trả lời kèm bằng chứng.

## 4. Hiểu xong thì giao cho skill chuyên môn

prompt-intake chỉ để hiểu; việc thực thi thuộc skill khác.

| Người dùng nói | Gọi skill |
|---|---|
| "bị lỗi rồi", "không chạy", "sai kết quả" | `diagnosing-bugs` / `systematic-debugging` |
| "viết test", "đảm bảo không lỗi" | `tdd` |
| "xem lại code", "soi code" | `code-review` |
| "giao diện xấu", "làm đẹp" | `frontend-design` |
| "chạy thử app", "kiểm tra UI" | `webapp-testing` |
| "tìm hiểu về X", "tra cứu" | `research` |
| "file Word / Excel / PPT / PDF" | `docx` / `xlsx` / `pptx` / `pdf` |
| "tạo skill mới" | `skill-creator` / `writing-skills` |

## 5. Ví dụ

| Người dùng gõ | Hiểu | Làm ngay | Chỉ hỏi khi |
|---|---|---|---|
| `app bị lỗi rồi` | có lỗi runtime | chạy app, đọc log/console trước | không tái hiện được → "lỗi hiện ra khi bạn làm gì? (a) mở app (b) bấm nút X (c) khác" |
| `làm đẹp cái này` | muốn cải thiện UI | xác định màn hình đang nói tới | hỏi phong cách: (a) tối giản (b) nhiều màu (c) giống trang khác |
| `tối ưu đi` | muốn nhanh/gọn hơn | đo trước (thời gian, kích thước) | đo xong vẫn không rõ mục tiêu |
| `ok chưa?` | muốn xác nhận | chạy test/build thật | — |

## 6. Không làm

- Không hỏi 4+ câu, không hỏi dồn nhiều lượt.
- Không hỏi thứ tự đọc file hay chạy lệnh là biết.
- Không im lặng đoán bừa rồi tỏ ra chắc chắn.
- Không trả lời "ok chưa" mà không kiểm tra.
