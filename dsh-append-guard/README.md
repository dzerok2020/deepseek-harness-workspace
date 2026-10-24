# dsh-append-guard — nhắc giữ thứ tự bộ nhớ

Plugin local cho DeepSeek Harness (DSH), phiên bản `0.1.0`, tương ứng G6. Plugin quan sát **outline** của bộ nhớ (danh sách định danh entry), phát hiện một số kiểu chèn/đổi thứ tự/xóa entry rồi nhắc agent khi kết thúc lượt. Mục tiêu là khuyến khích append-only: thêm entry mới ở cuối để hạn chế thay đổi tiền tố prompt đã được cache.

**Đây không phải cơ chế bảo vệ nội dung hay đo cache.** Plugin không chặn thao tác ghi trước khi xảy ra, không tự hoàn tác bộ nhớ, không đo cache hit/token/chi phí và không bảo đảm tiền tố prompt thực sự giữ nguyên.

## 1. Khi nào có ích?

- Một tool bộ nhớ trả về danh sách `entries` có `id` hoặc `key` ổn định sau mỗi lần ghi.
- Bạn muốn agent được nhắc khi danh sách đang quan sát có entry mới chen vào giữa, entry cũ đổi thứ tự hoặc lịch sử bị rút ngắn.
- Bạn muốn gợi ý một số tool ít dùng có thể được host nạp trễ. `deferLoading` là tùy chọn của host, nghĩa là chỉ nạp mô tả tool khi cần; plugin này **không tự bật nó**.

Không có `entries` phù hợp thì plugin không có dữ liệu để so sánh. Chỉ cài plugin không có nghĩa mọi kho memory đã được bảo vệ.

## 2. Cài, gỡ và restart

Các lệnh dưới đây dành cho người quản trị thực hiện khi muốn thay đổi profile `web`; đọc README không tự cài hay restart:

```bash
dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-append-guard
```

Sau khi cài thành công, **restart tiến trình DSH đang dùng profile đó** để nạp plugin. Package local là `private: true`, khai báo bundle qua `cordis.patch.yml`; không cần cài từ npm công khai.

Gỡ bằng tên package, rồi restart DSH lần nữa:

```bash
dsh plugin --profile web remove dsh-append-guard
```

Tắt tạm bằng cách đặt `DSH_APPEND_GUARD=off` trong môi trường **trước khi khởi động DSH**. Plugin kiểm tra đúng chuỗi `off` khi `apply()` chạy; đặt biến trong shell của một tool sau đó không tắt tiến trình DSH hiện có.

## 3. Luồng hoạt động thực tế

1. Hook `tools/post-execute` đợi tool thực thi xong, đếm số lần gọi tool.
2. Chỉ tool có tên khớp chính xác `memoryTools` và không thuộc `exemptTools` mới được xét.
3. Bỏ qua nếu `result` hoặc `exec.result` có `ok: false` hay `isError: true`, hoặc lời gọi được đánh dấu có chủ ý như mô tả bên dưới.
4. Đọc `entries` trực tiếp, trong `result.entries`, hoặc từ JSON trong payload text. Text có thể nằm ở `content`, các phần `content[].text`, `output`, `text`, hay `result.output` (theo thứ tự ưu tiên của hàm đọc).
5. Quan sát đầu tiên có outline không rỗng chỉ làm mốc; các quan sát tiếp theo được so sánh bằng định danh `id`, nếu không có thì `key`.
6. Khi `agent/turn-stopping`, nếu có vi phạm và `nudgeOnStop` bật, plugin gửi một lời nhắc qua `agent.steer()`, kèm tối đa năm tên tool ít dùng nếu có; sau đó xóa outline và vi phạm của lượt.

State được tách theo đối tượng agent bằng `WeakMap`; tool thiếu agent dùng state dự phòng. Bộ đếm tool được giữ lại trong vòng đời instance plugin, không được lưu bền qua restart.

## 4. Cấu hình và giá trị mặc định chính xác

Bảng này mô tả object cấu hình mà host truyền vào `apply(ctx, rawConfig)`. Bundle đi kèm chỉ đăng ký plugin, không đặt override; việc đặt override vào profile phải theo cấu trúc cấu hình của host DSH đang dùng.

| Khóa | Mặc định | Ý nghĩa thực tế |
| --- | --- | --- |
| `enabled` | `true` | Chỉ `false` tắt đăng ký hook. |
| `memoryTools` | `["memory_remember", "memory_profile_update", "mnemon_remember"]` | Danh sách tên tool được quan sát, khớp chính xác. |
| `exemptTools` | `["forget", "delete", "restore", "archive", "undo"]` | Tên tool được miễn xét; không tự khớp theo hậu tố. |
| `rareToolUses` | `1` | Tool có tổng số lần gọi không quá ngưỡng này được coi là ít dùng. |
| `rarityWindow` | `20` | Được nhận/chuẩn hóa nhưng hiện **không được dùng** để cắt cửa sổ hoặc giảm bộ đếm. |
| `neverDefer` | `["read", "write", "edit", "apply_patch", "bash", "ops_bash", "read_image", "web_search"]` | Không gợi ý nạp trễ những tên này. |
| `nudgeOnStop` | `true` | Chỉ `false` tắt lời nhắc cuối lượt. |

Ví dụ object override (không phải lệnh để chạy):

```json
{
  "enabled": true,
  "memoryTools": ["memory_remember", "mnemon_remember"],
  "exemptTools": ["forget", "delete", "restore", "archive", "undo"],
  "rareToolUses": 2,
  "rarityWindow": 20,
  "neverDefer": ["read", "write", "edit", "bash", "ops_bash"],
  "nudgeOnStop": true
}
```

Danh sách override **thay thế** danh sách mặc định, không nối thêm. Mảng rỗng được chấp nhận. Giá trị không phải mảng dùng lại mặc định; phần tử không phải chuỗi không rỗng bị lọc. Hai ngưỡng số chỉ nhận số nguyên dương, còn lại quay về mặc định. Không có cấu hình `maxRefusals`.

## 5. Ví dụ outline

Ví dụ payload minh họa của một tool memory đã được host đăng ký:

```json
{"entries":[{"id":"a"},{"id":"c"}]}
```

So sánh quan sát kế tiếp trong cùng lượt:

| Outline sau | Kết quả dự kiến |
| --- | --- |
| `a, c, d` | `append`: thêm cuối, không nhắc. |
| `a, b, c` | `insert`: entry mới chen giữa, nhắc cuối lượt. |
| `c, a` | `insert`: phát hiện thứ tự cũ bị đảo. |
| `a` | `rewrite`: lịch sử rút ngắn, nhắc. |
| `a, c` với nội dung entry thay đổi | Không phát hiện sửa nội dung nếu định danh/thứ tự vẫn vậy. |

Runtime có thể miễn một lời gọi nếu `args.append ?? args.intent ?? args.mode` bằng `"intentional"` hoặc `"append"`. Ví dụ `append: "intentional"` chỉ là **cách runtime đọc tín hiệu**, không phải tham số hợp lệ mặc nhiên của mọi tool. Không thêm khóa ngoài schema tool, không dùng tín hiệu này thay quyền sửa/xóa của người dùng. Lời gọi miễn xét cũng không cập nhật mốc outline.

## 6. Giới hạn cần biết trước khi tin lời nhắc

- Chỉ kiểm tra định danh/thứ tự, **không so nội dung entry** hay byte prompt. Entry thiếu định danh hoặc có định danh trùng làm kết quả kém tin cậy; cùng độ dài nhưng thay thế định danh ở cuối cũng có thể lọt.
- Mốc bị xóa mỗi lần kết thúc lượt, kể cả sau khi nhắc; không so lịch sử giữa hai lượt. Nếu mốc vẫn rỗng, quan sát kế tiếp lại được coi là mốc đầu tiên.
- Chỉ quan sát kết quả tool được liệt kê và có outline; ghi bằng shell, thay đổi bên ngoài hoặc tool không trả `entries` không được kiểm tra.
- Đây là hậu kiểm: khi lời nhắc xuất hiện, thao tác đã chạy. Thuộc tính `blocking` trong policy không biến thành một lệnh chặn/rollback riêng ở wiring.
- Gợi ý tool ít dùng dùng bộ đếm tích lũy, không phải “20 lượt gần nhất” dù tên/comment `rarityWindow` gợi ý như vậy. Gợi ý chỉ xuất hiện cùng một lời nhắc vi phạm, không có cơ chế áp dụng `deferLoading` tự động.
- Thông điệp nói cache bị invalid là lời nhắc theo heuristic (quy tắc suy đoán), **không phải đo lường cache thật**. Cache của provider có thể còn phụ thuộc TTL, cách serialize và nhiều yếu tố khác.

## 7. Test và kiểm chứng

Từ thư mục gốc workspace:

```bash
cd dsh-append-guard
node --test test/
```

`package.json` có `npm test` tương đương. Test policy kiểm tra so sánh outline, config và gợi ý; test wiring mô phỏng hai hook, state theo agent, miễn xét và kill-switch. Các test dùng môi trường Node với dependency DSH khả dụng; không phải thử nghiệm cache/provider hay xác minh tích hợp end-to-end với mọi tool memory.

Khi đọc kết quả, lấy số `tests`, `pass`, `fail` và exit code từ lần chạy thực tế; không coi số test trong tài liệu là chứng nhận cài đặt hiện tại. Nguồn hành vi: [policy](lib/policy.js), [wiring](lib/index.js), [package](package.json), [bundle](cordis.patch.yml).
