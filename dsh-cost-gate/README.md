# dsh-cost-gate

Đo usage thật qua `llm/stream`, cảnh báo chi phí và ngăn lời gọi tool thất bại lặp lại. **Không kết thúc turn chỉ vì vượt token hoặc số bước.**

## Chính sách

- `turnFreshTokens`, `turnOutputTokens`, `sessionFreshTokens`, `maxStepsPerTurn`: chỉ cảnh báo. Chi phí cao không tự chứng minh công việc vô ích.
- Sau ba lần **liên tiếp** cùng tool, cùng arguments và cùng kết quả `isError: true`, lần gọi giống tiếp theo không chạy tool body. Tool trả lỗi `ANTI_WASTE_REPEAT`, hướng dẫn đổi giả thuyết, lấy bằng chứng khác hoặc báo nhánh bị kẹt.
- Không reject `agent/pre-step`; agent vẫn có thể tiếp tục công việc khác hoặc trả lời người dùng.
- Tool thành công, đổi arguments, lỗi khác nhau hoặc turn mới phá chuỗi lặp. Các session độc lập.
- `run_code` có bộ đếm wrapper riêng để tool lồng bên trong vẫn được kiểm tra. Kết quả song song không được dùng để kết luận vòng lặp tuần tự.
- Hook `tools/execute` chạy trong đường dispatch chuẩn, sau admission/permission của host. Không mở rộng quyền, không bỏ qua sandbox hay yêu cầu xác nhận.

## Ngưỡng cảnh báo mặc định

| Chỉ số | Mặc định |
|---|---:|
| `turnFreshTokens` | 150.000 |
| `turnOutputTokens` | 60.000 |
| `sessionFreshTokens` | 3.000.000 |
| `maxStepsPerTurn` | 60 |
| `warnRatio` | 0.8 |
| `missFreshThreshold` | 50.000 |
| `consecutiveMissWarn` | 3 |

Fresh input và cache read được host khai báo riêng. Plugin giữ fingerprint dạng hash trong RAM, không ghi arguments hoặc nội dung lỗi vào status. Đối tượng không fingerprint được hoặc JSON trên 65.536 ký tự không được dùng làm bằng chứng lặp.

## Điều khiển và giới hạn

- `DSH_COST_GATE=off`: tắt plugin.
- `cost-gate-allow` là marker cũ; trường status `allowed` chỉ còn phản ánh marker tồn tại, không dùng để cấp quyền hoặc bypass bộ chống lặp mới.
- Status ở `$DSH_HOME/cost-gate-status.json` (mặc định `~/.dsh/cost-gate-status.json`).
- Đây là chống lặp **xác định**, không phải bộ đánh giá AI. Chưa nhận biết mọi dạng đọc lại, poll vô ích, đổi tên cùng một việc hoặc tool báo lỗi bằng text nhưng không đánh dấu `isError`.
- Không bảo đảm mọi task hoàn tất: lỗi provider, cancellation, gate khác và thiếu quyền vẫn có thể dừng lượt. Không tự retry vô hạn hoặc tự restart DSH.

## Cài trong profile

```bash
cd ~/.dsh/profiles/web
pnpm add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-cost-gate
```

Profile phải có bundle `dsh-cost-gate`. Cần restart DSH để tiến trình nạp bản mới; test trong workspace không chứng minh tiến trình đang chạy đã đổi.

## Test

```bash
node --test test/
```

Bộ test kiểm tra cảnh báo không hard-stop, reset turn/session, lỗi lặp, đọc/test thành công, PTC lồng, lỗi khác nhau và dispatch song song. Mock hook không thay thế kiểm thử đầu-cuối trên profile đang chạy.
