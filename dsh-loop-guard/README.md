# dsh-loop-guard — chặn vòng lặp "Chưa có yêu cầu mới"

Plugin cục bộ cho DeepSeek Harness (DSH), sửa **nguyên nhân gốc** của hiện tượng agent
trả lời lặp vô hạn những câu như:

> "Chưa có yêu cầu mới — mình đang chờ bạn nhé."
> "Chờ bạn nhé — chưa có yêu cầu mới nên mình không làm gì thêm."

## 1. Vì sao bị lặp (nguyên nhân gốc)

Trong một turn, DSH dựng lại phần "runtime context" trước **mỗi bước** (mỗi lần gọi model):

1. Plugin `@furongjun1999/dsh-memory` đẩy vào runtime context hai khối:
   - `lingshu:auto-recall` — `【灵枢最近记忆】`
   - `lingshu:session-window` — `【本会话近期对话】` (thay đổi theo **mọi** message gần nhất,
     kể cả message model vừa sinh ở bước trước)
2. Vì cửa sổ hội thoại đổi sau mỗi bước, **text runtime context đổi mỗi bước**.
3. Host `@deepseek-ai/dsh-agent-loop` (`RuntimeContextProjection.project`) thấy text khác bản
   đã ghi nhận nên **append thêm một user message snapshot mới** mỗi bước.
4. Vòng turn có chốt dừng:

   ```js
   if (turnEnds && decision.messages.length === 0) break;
   ```

   `decision.messages` **không bao giờ rỗng** (luôn có snapshot mới) ⇒ turn không bao giờ đóng.
5. Model hết việc thật, không có yêu cầu mới, nên trả lời "Chưa có yêu cầu mới — mình đang chờ bạn nhé".
   Câu trả lời đó lại là message mới nhất ⇒ cửa sổ lại đổi ⇒ **vòng lặp tự nuôi**, mỗi vòng còn
   phình context thêm một bản snapshot.

Đây là xung đột **hợp đồng** giữa plugin bên thứ ba (thiết kế "push mỗi bước, kể cả trùng nội dung")
và chốt dừng của host.

## 2. Cách plugin này sửa

`dsh-loop-guard` chèn một hook `system-prompt/assemble`, **đóng băng (freeze) text của các khối
biến động theo từng turn**:

- Lần assemble **đầu tiên** của một turn: ghi nhận text của từng khối vào cache.
- Các bước **sau trong cùng turn**: ghi đè text bằng bản đã ghi nhận ⇒ text runtime context
  **không đổi trong turn** ⇒ `project()` trả `undefined` ⇒ `decision.messages.length === 0`
  ⇒ turn đóng bình thường.
- Khi có `turn/start` **thật** hoặc tin nhắn **thật** của người dùng: **xoá cache** ⇒ turn mới lại được
  bơm bản mới nhất. Kết quả: tối đa **một** snapshot runtime context cho mỗi turn.
- **Chỉ tin THẬT mới xoá cache.** Snapshot runtime context do host tiêm cũng đi qua sự kiện
  `user/message` (source `kind:"runtime-context"`). Nếu tính nó là "turn mới" thì cache bị xoá ngay
  mỗi bước và plugin thành vô dụng (`freezes: 0`) — đúng ca lỗi cần chữa. Vì vậy `shouldRefresh` kiểm
  tra thêm `source.kind`: thiếu `source` ⇒ tin thật; `kind === 'user'` ⇒ tin thật; mọi kind khác
  (`runtime-context`, `plugin:aegis`, `plugin:stratagate-memory`, `time-context`, `system-reminder`…)
  ⇒ tin tiêm, **không** xoá cache.

Nếu một khối đã có trong cache mà bước này lại **vắng mặt** (ví dụ plugin kia tạm bỏ khối), plugin
sẽ **chèn lại** bản cũ (`reinsert`) để chặn kiểu lặp flip-flop *có → không → có* (vẫn làm snapshot đổi).

Plugin **không** đăng ký tool, **không** import package `@deepseek-ai/*` nào (chỉ `node:fs`,
`node:path` và `./policy.js`) nên chạy được ngay trong workspace, không cần cài thêm gì.

## 3. Cấu hình

Ghi trong `cordis.patch.yml` / config của DSH (mọi field đều tuỳ chọn):

```yaml
sections:        # khối bị đóng băng theo turn
  - "lingshu:session-window"
  - "lingshu:auto-recall"
  # "*" = đóng băng mọi khối context (dùng khi nghi plugin lạ khác gây loop)
refreshEvents:   # sự kiện mở turn mới => xoá cache (chỉ tin THẬT; tin tiêm bị lọc)
  - "turn/start"
  - "user/message"
reinsert: true   # chèn lại khối đã cache nhưng vắng ở bước này
maxSessions: 64  # trần LRU số session nhớ cache
enabled: true
```

Tắt nhanh khi cần:

```bash
DSH_LOOP_GUARD=off dsh ...
```

Nhận các giá trị tắt: `off`, `0`, `false`, `no`, `tắt`, `tat` (không phân biệt hoa thường).

Khớp tên khối: chính xác, tiền tố + `*` (ví dụ `lingshu:*`), hoặc `"*"`.

## 4. Kiểm tra plugin đang chạy

Plugin ghi trạng thái ra `$DSH_HOME/loop-guard-status.json` (mặc định `~/.dsh/loop-guard-status.json`),
có throttle 2 giây:

```json
{
  "plugin": "dsh-loop-guard",
  "enabled": true,
  "freezeSections": ["lingshu:session-window", "lingshu:auto-recall"],
  "counters": { "assemblies": 42, "stores": 4, "freezes": 78, "reinserts": 0, "refreshes": 1 },
  "activeSessions": 1,
  "lastFreeze": "2026-10-08T...",
  "lastRefresh": "2026-10-08T..."
}
```

`freezes` tăng đều mà `refreshes` gần như đứng yên trong một turn = plugin đang làm việc.
Log cũng được ghi qua logger của DSH ở 5 lần freeze đầu, sau đó cách 25 lần một dòng.

## 5. Test

```bash
node --test test/
```

21 test, trong đó có **mô phỏng vòng turn thật của host**:

- `TÁI HIỆN LỖI`: không có guard ⇒ snapshot đổi mỗi bước ⇒ turn **không bao giờ** đóng (lặp vô hạn).
- `ĐÃ SỬA`: có guard ⇒ turn đóng ngay bước thứ 2.
- `tái hiện lỗi gốc`: refresh theo **mọi** `user/message` ⇒ `freezes: 0`; lọc tin tiêm ⇒ đóng băng được.
- Tin tiêm (`runtime-context` snapshot, `plugin:aegis`, `time-context`, `system-reminder`) **không** xoá cache.
- Tin nhắn **thật** của người dùng (có `source.kind === 'user'`) và `turn/start` vẫn xoá cache.
- Mỗi turn mới vẫn được bơm lại đúng một snapshot.
- Khối biến mất giữa turn không làm turn mở lại.
- Cô lập theo session, trần LRU, dữ liệu méo không làm throw.

Bộ đếm (`stores`/`freezes`/`reinserts`) đếm **theo từng khối**, `assemblies`/`refreshes` đếm theo lần gọi.

Lưu ý: plugin này **không thay thế** việc sửa `dsh-memory`; nó là lớp bảo vệ phía host, hoạt động
kể cả khi plugin gốc được cập nhật.

## 6. Cài đặt

```bash
dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-loop-guard
```

Cài xong **phải khởi động lại DSH** thì plugin mới được nạp. Sau khi restart, mở
`~/.dsh/loop-guard-status.json` để xác nhận.
