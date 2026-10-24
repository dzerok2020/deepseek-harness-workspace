# dsh-eval-gate

Cổng "tập biên + tập giữ nguyên" cho DeepSeek Harness (mục **G4** trong
`docs/AGENT-FORMULA-DSH.vi.md`). Ý tưởng: một thay đổi chỉ được coi là đã xong
khi agent chứng minh được **cả hai phía** của nó — có cái ĐỔI đúng như mong đợi,
và có cái KHÔNG đổi (không phá hành vi cũ).

## 1. Sentinel là gì

Hai nhãn chuỗi mà agent phải ghi ra trong output của một lệnh kiểm tra:

| nhãn | nghĩa |
|---|---|
| `must-change` | test/biểu thức chứng minh hành vi MỚI đã xuất hiện |
| `must-keep` | test/biểu thức chứng minh hành vi CŨ vẫn còn |

## 2. Cổng chạy thế nào

1. Hook `tools/post-execute` nhìn mọi lệnh `bash`/`shell` đã chạy: nếu lượt này
   có ghi file (`write`/`edit`/…) thì lượt được đánh dấu "có thay đổi".
2. Nếu output của lệnh kiểm tra chứa `must-change` VÀ `must-keep`, lượt được
   coi là đã đủ bằng chứng.
3. Hook `agent/turn-stopping` chặn lượt đóng nếu còn thay đổi mà chưa có bằng
   chứng; harness tự steer thêm một lượt, nêu rõ còn thiếu vế nào.
4. Chạy test THẤT BẠI thì các nhãn trong output đó **không** được tính là bằng
   chứng (một lần đỏ không chứng minh được gì).

- Lượt chỉ đọc (không sửa file) đi qua không bị hỏi.
- Trần nhắc (`maxRefusals`, mặc định 2) để không tạo vòng lặp vô hạn.
- Trạng thái tách riêng theo từng agent (không rò rỉ chéo).

## 3. Cài đặt

    dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-eval-gate
    # restart dsh

Gỡ:

    dsh plugin --profile web remove dsh-eval-gate

## 4. Cấu hình (trong `cordis.patch.yml`, mục `insert` của plugin)

| khoá | mặc định | ý nghĩa |
|---|---|---|
| enabled | true | bật/tắt toàn bộ plugin |
| requireSentinels | true | cổng bật; tắt thì chỉ ghi nhận, không chặn |
| maxRefusals | 2 | số lần tối đa nhắc trong một phiên |

Tắt tạm bằng biến môi trường: `DSH_EVAL_GATE=off`.

## 5. Kiểm chứng

    cd dsh-eval-gate && node --test test/

Kỳ vọng: **20/20 pass** (13 test cho `lib/policy.js`, 7 test cho phần wiring).
