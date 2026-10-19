# Prompt intake cho DeepSeek Harness

Trợ lý làm rõ yêu cầu dành cho người mới: bạn viết tự nhiên bằng tiếng Việt, có thể viết tắt hoặc không dấu. Plugin đưa hướng dẫn `prompt-intake` vào lượt xử lý tin nhắn của người dùng; không thay thế prompt gốc.

## Cách dùng

Sau khi cài, **khởi động lại tiến trình DSH** để nạp plugin; chỉ refresh trang Web không đủ. Gửi yêu cầu như bình thường, ví dụ:

- "lam app quan ly chi tieu, toi chua biet bat dau tu dau"
- "them tim kiem vao danh sach, giu cac chuc nang cu"
- "bi loi khi bam luu: <dán thông báo lỗi>"

AI được hướng dẫn tìm ngữ cảnh trước, nêu giả định và hỏi tối đa 3 câu có lựa chọn khi cần. Với quyết định ảnh hưởng lớn như xóa dữ liệu, chi phí, bảo mật, triển khai hoặc kiến trúc khó đổi, phải chờ xác nhận. Đây là hướng dẫn cho mô hình, không phải cơ chế chặn thao tác ở tầng thực thi.

## Điều khiển

Gửi riêng một trong các lệnh:

- `/intake status`: hỏi trạng thái.
- `/intake off`: tắt intake cho agent hiện tại.
- `/intake on`: bật lại.
- `/intake skip <yêu cầu>`: bỏ qua intake cho tin nhắn này; quy tắc an toàn khác vẫn áp dụng.

Trạng thái mặc định bật, lưu trong bộ nhớ theo đối tượng agent; không đảm bảo được giữ qua restart hoặc tái tạo agent. Đặt `DSH_PROMPT_INTAKE=off` trước khi khởi động DSH để không đăng ký plugin.

## Thiết kế và giới hạn

- Dùng hook `agent/pre-step`, chỉ xử lý nguồn người dùng `source.kind=user`.
- Giữ nguyên tin nhắn, ảnh, ID và dữ liệu trả về của các hook khác; thêm một notice có nguồn `prompt-intake`.
- Đọc chính sách từ `~/.dsh/skills/prompt-intake/SKILL.md` khi nhận yêu cầu. Nếu không đọc được, thêm thông báo giới hạn thay vì âm thầm bịa chính sách.
- Không gọi thêm mô hình riêng, nhưng hướng dẫn được thêm vào ngữ cảnh có thể làm tăng token đầu vào.
- Đây là bản tích hợp chính sách intake, **chưa phải** bộ tối ưu prompt bằng DSPy: không có tập dữ liệu đánh giá, thuật toán tìm prompt hay số đo chứng minh chất lượng tăng.
- Không bảo đảm AI suy ra mọi ý định chưa nói rõ. Những điểm quan trọng vẫn cần người dùng xác nhận.

## Kiểm chứng

Chạy tại workspace:

```sh
node --test dsh-prompt-intake/test/intake.test.mjs
```

7 test kiểm tra giữ nguyên yêu cầu/ảnh, metadata, điều khiển theo agent, bỏ qua nguồn không phải người dùng, hủy/từ chối, lỗi đọc chính sách và các hook nối tiếp.

Đã kiểm tra thêm entry cài trong profile với `createUserMessage` thật và chính sách trên đĩa. Đây là smoke test tại điểm tích hợp với context giả lập, không phải một lượt Web end-to-end.

Sau restart, nghiệm thu thủ công bằng `/intake status`, rồi gửi một yêu cầu mơ hồ và một yêu cầu có quyết định rủi ro. Kiểm tra AI làm rõ đúng ý, không tự thêm tính năng và chờ xác nhận trước phần rủi ro. Chưa có kết quả nghiệm thu này trong phiên triển khai.
