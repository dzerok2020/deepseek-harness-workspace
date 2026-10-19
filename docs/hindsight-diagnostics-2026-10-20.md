# Nâng chẩn đoán Hindsight — 2026-10-20

## Phạm vi

Công cụ `tools/hindsight-health.py` kiểm tra quyền file và địa chỉ nghe cục bộ, sau đó gọi `/health` và endpoint `memories/dry-run-extract` với ví dụ tổng hợp chứa port 45678. Không ghi mẫu vào bộ nhớ, không đổi model, service hoặc cơ sở dữ liệu.

Lỗi được gắn với bước bảo vệ truy cập, kết nối hoặc trích xuất LLM. HTTP được phân nhóm xác thực/quyền truy cập, endpoint/phương thức, giới hạn lượt gọi, timeout, dịch vụ/upstream và yêu cầu bị từ chối. Không in URL lỗi, response body, thông tin xác thực hoặc nội dung bộ nhớ.

## Bằng chứng

Chạy tại workspace:

```sh
python3 test/hindsight-health.test.py
python3 tools/hindsight-health.py
```

Kết quả test hồi quy:

```text
Ran 11 tests in 0.029s

OK
```

Kết quả kiểm tra dịch vụ thật trong phiên này, exit code 0:

```text
ĐẠT: trích xuất LLM thật (không lưu dữ liệu), loopback và quyền file
```

Test giả lập kiểm tra HTTP 401/403/404/405/408/429/500/503/504/400, timeout, mất kết nối, JSON sai, dữ liệu trích xuất không hợp lệ và lỗi quyền file. Các trường hợp lỗi không được báo ĐẠT và không được lộ chuỗi bí mật mẫu.

## Giới hạn

Lỗi cũ không tái hiện ở lần kiểm tra thật này; chưa xác định nguyên nhân của lần lỗi trước và không coi thay đổi thông báo lỗi là sửa nguyên nhân dịch vụ. Kết quả ĐẠT chỉ là một lần kiểm tra, không chứng minh dịch vụ luôn ổn định hoặc toàn bộ luồng Hindsight đã được kiểm chứng. Không có dữ liệu thật nào được dùng làm mẫu trích xuất.

Nếu lỗi xuất hiện lại, chạy công cụ và lưu dòng lỗi đã phân loại; không gửi khóa API hay nội dung response riêng tư. Mã HTTP chỉ định hướng điều tra, không tự chứng minh nguyên nhân gốc.
