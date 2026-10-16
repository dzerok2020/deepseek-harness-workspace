# Sửa bộ nhớ và kiểm chứng — 16/10/2026

## Nguyên nhân và phạm vi sửa

Hindsight trả health 200 nhưng retain thất bại vì provider `claude-code` báo `Claude Code authentication failed` và `Not logged in · Please run /login`. Cấu hình có đường API tương thích OpenAI nhưng chọn sai loại provider.

- Đổi duy nhất `HINDSIGHT_API_LLM_PROVIDER` sang `openai` trong cấu hình cá nhân; giữ nguyên endpoint, model và credentials.
- Đặt quyền file cấu hình cá nhân thành 0600; không đưa credentials vào Git.
- Đặt `HINDSIGHT_API_HOST=127.0.0.1` trong systemd unit cá nhân, restart riêng daemon Hindsight. Không restart DSH.
- Thêm probe dry-run extraction gọi LLM thật nhưng không lưu memories; kiểm tra giá trị thử, quyền file và listener IPv4/IPv6 ngoài loopback trên cổng 9077/9999.
- Tích hợp test Python và test tài liệu vào health script. Thay kết luận quá rộng bằng giới hạn đúng phạm vi kiểm tra.
- Sửa dấu phân cách trong bảng tài liệu OmniRoute sau khi test tái hiện lỗi 25 pass / 1 fail.

## Bằng chứng thực thi

- Daemon lắng nghe `127.0.0.1:9077`; file cấu hình mode `0o600`.
- Dry-run extraction: `ĐẠT: trích xuất LLM thật (không lưu dữ liệu), loopback và quyền file`.
- Vòng ghi/đọc trong bank UUID tạm: `success: true`, `items_count: 1`, `roundtrip_match= True result_count= 1`. Bank thử đã được xóa, không xóa bank thật.
- Khôi phục tuần tự 9 operation retain mới nhất theo document: cả 9 `completed`. Không replay các lần thử cũ trùng document để tránh ghi đè dữ liệu mới bằng bản cũ.
- Làm mới 6 mental models: `knowledge_refresh_completed=6/6`; kiểm tra sau đó cả 6 `stale=False`.
- Test bộ probe: `Ran 5 tests`, `OK`.
- Test tài liệu sau sửa: `tests 26`, `pass 26`, `fail 0` (trước khi thêm báo cáo này).
- Loop guard: `tests 21`, `pass 21`, `fail 0`.
- Vibe guard: `tests 30`, `pass 30`, `fail 0`.
- Health tích hợp trước khi thêm báo cáo này: `39 đạt, 0 lỗi`, exit 0.

## Chạy lại

```bash
bash tools/dsh-health.sh
```

Probe có gọi model thật, có thể tốn token và phụ thuộc mạng/upstream; lỗi kết nối sẽ làm kiểm tra thất bại thay vì báo xanh giả. Probe thường xuyên chỉ kiểm tra extraction; vòng persistence ghi/đọc đã được chạy riêng trong lần sửa này.

## Giới hạn và phục hồi

Các operation cũ thất bại vẫn được giữ làm lịch sử, không xóa để làm đẹp thống kê. Thành công của lần sửa không chứng minh mọi plugin bộ nhớ khác, tải dài nhiều giờ, UI hay mọi dự án người dùng đều hết lỗi. Chưa verify các phạm vi đó trong lát sửa này.

Cấu hình service và env cá nhân nằm ngoài Git. Nếu cần rollback provider, phải dùng backend có credentials hợp lệ; khôi phục `claude-code` khi chưa đăng nhập sẽ tái tạo lỗi cũ. Giữ loopback và mode 0600 khi rollback. Để bỏ probe mới, revert commit workspace tương ứng; không cần xóa dữ liệu thật.
