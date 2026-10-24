# dsh-eval-gate — nhắc kiểm tra phần đổi và phần phải giữ

Plugin local cho DeepSeek Harness (DSH), phiên bản `0.1.0`, tương ứng G4. Khi quan sát thấy agent sửa file, plugin yêu cầu hai loại **sentinel** trước khi kết thúc lượt. Sentinel ở đây là nhãn trong output tool, giúp phân biệt test chứng minh hành vi mới (`must-change`) và test bảo vệ hành vi cũ (`must-keep`).

**Mức bảo đảm thực tế:** đây là cổng nhắc dựa trên tên tool, chuỗi output và một số cờ lỗi; không phải hệ thống xác minh test độc lập. Nó không tự chứng minh test từng đỏ trước khi sửa, không kiểm tra độ bao phủ và không thay người dùng nghiệm thu.

## 1. Cách dùng cho người mới

Ví dụ bạn sửa phép tính tổng:

1. Viết test `must-change: cong-so-am` cho lỗi cần sửa; chạy và giữ lại bằng chứng test đỏ trước khi sửa.
2. Giữ một test `must-keep: cong-so-duong` cho hành vi đang đúng.
3. Sửa code rồi chạy cả hai test bằng runner thật (chương trình chạy test, ví dụ `node --test`).
4. Đọc exit code và nội dung báo cáo để bảo đảm cả hai thật sự pass; đừng chỉ in nhãn bằng `echo`.
5. Khi kết thúc lượt, plugin kiểm tra đã có ít nhất một quan sát được tính là pass cho mỗi loại sentinel đang bật chưa.

Ví dụ tên test Node.js (đoạn minh họa, không tự tạo file):

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('must-change: cong-so-am', () => {
  assert.equal(sum(-2, 1), -1);
});

test('must-keep: cong-so-duong', () => {
  assert.equal(sum(2, 3), 5);
});
```

`sum` phải là hàm thật được import từ dự án của bạn. Hai nhãn trong ví dụ không tự biến kiểm tra thành bằng chứng hợp lệ; assertion, baseline trước sửa và kết quả runner vẫn phải được kiểm tra.

## 2. Luồng hoạt động đúng theo code

- `tools/post-execute` ghi nhận đường dẫn từ `path`, `file_path`, `filePath` hoặc `target` của đúng bốn tên tool: `write`, `edit`, `apply_patch`, `str_replace_editor`.
- Việc ghi nhận thay đổi **không kiểm tra tool ghi có thành công không**. Thậm chí lời gọi ghi thất bại vẫn có thể khiến lượt bị yêu cầu test nếu có đường dẫn.
- Hook đọc text từ `content` (chuỗi hoặc mảng phần text), rồi `output`, `text`, hoặc `result.output`; nếu không đọc được text từ kết quả chính thì thử `exec.result`.
- Trong text của **bất kỳ tool nào**, nó tìm chuỗi `must-change:` và `must-keep:`. Runtime không giới hạn việc quét vào bash, shell hay test runner dù mục đích thiết kế là test.
- Một quan sát được tính là pass nếu kết quả chính không có `ok: false` và không có `isError: true`. Plugin không parse exit code của shell, `fail` trong TAP hay trạng thái lỗi lồng trong `exec.result` để quyết định pass.
- Khi `agent/turn-stopping`, không có file được ghi nhận thì cho kết thúc. Có thay đổi mà thiếu một loại sentinel đang bật thì gửi `agent.steer()` với thông điệp `EVAL GATE`, yêu cầu bổ sung kiểm tra.
- Nếu đủ sentinel, state của lượt được xóa. Nếu còn thiếu, state được giữ cho lần thử dừng tiếp theo. State theo agent dùng `WeakMap`; sự kiện tool thiếu agent dùng một state dự phòng riêng.

Một sentinel pass cho mỗi loại là đủ cho **cả lượt**, không phải mỗi file. Một lần fail sau một lần pass cũng không hủy pass cũ; danh sách quan sát chỉ tích lũy cho tới lúc reset bình thường.

## 3. Cài, gỡ và restart

Đây là hướng dẫn thao tác khi người quản trị muốn bật plugin, không phải lệnh đã chạy trong quá trình đọc tài liệu:

```bash
dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-eval-gate
```

Sau khi cài thành công, **restart DSH đang dùng profile `web`** để plugin được nạp. Package `private: true`, có bundle trỏ tới `cordis.patch.yml`.

Gỡ rồi restart DSH:

```bash
dsh plugin --profile web remove dsh-eval-gate
```

Tắt tạm: đặt `DSH_EVAL_GATE=off` trong môi trường trước khi khởi động DSH. Chỉ đúng chuỗi `off` được nhận; thay biến trong shell tool không thay môi trường tiến trình DSH đang chạy.

## 4. Cấu hình — chỉ có ba khóa

Object sau là toàn bộ mặc định mà `compileEvalConfig()` trả về:

```json
{
  "enabled": true,
  "changeGate": true,
  "keepGate": true
}
```

| Khóa cấu hình | Mặc định | Tác dụng |
| --- | --- | --- |
| `enabled` | `true` | `false` tắt plugin, không đăng ký hook. |
| `changeGate` | `true` | `false` bỏ yêu cầu có `must-change` pass. |
| `keepGate` | `true` | `false` bỏ yêu cầu có `must-keep` pass. |

Chỉ boolean `false` tắt các khóa; các giá trị khác không phải cách tắt được hỗ trợ. Tắt cả hai gate cho phép lượt dừng mà không cần sentinel. Cấu hình là object host truyền vào `apply(ctx, rawConfig)`; bundle đi kèm chỉ đăng ký plugin, chưa có override. Đặt override theo cấu trúc profile của phiên bản DSH đang sử dụng.

**Không có `requireSentinels` và không có `maxRefusals`.** Trường `refusals` chỉ là bộ đếm nội bộ, không giới hạn nhắc. Nếu thiếu sentinel mãi, plugin có thể nhắc lại ở mọi lần dừng; không được dựa vào một trần mặc định hai lần.

## 5. Nhãn, ý định và chẩn đoán

Tên sentinel lấy từ phần text sau dấu hai chấm. Không có tên thì dùng `(unnamed)`. Runtime cũng đọc `args.sentinel ?? args.intent`; nếu bằng `must-change` hoặc `must-keep`, giá trị đó ghi đè loại của mọi nhãn tìm được trong lời gọi đó. Đây là hành vi parser, **không cấp quyền thêm tham số ngoài schema của tool**.

Khi thấy lời nhắc mà bạn đã chạy test:

1. Kiểm tra runner thật có in đúng `must-change:` / `must-keep:` không, phân biệt chữ hoa/thường.
2. Kiểm tra output được host đưa vào trường text mà plugin đọc được không.
3. Kiểm tra tool ghi và tool test có cùng đối tượng agent không.
4. Đọc kết quả thật và exit code; không in nhãn giả để làm cổng im lặng.

## 6. Giới hạn quan trọng

- Ghi file qua `bash`, `ops_bash`, script hay tool tên khác **không được theo dõi**. `apply_patch` không cung cấp đường dẫn ở một trong các khóa được đọc cũng có thể không bị ghi nhận. Đây không phải watcher của filesystem hay `git diff`.
- Quét mọi tool text gây false positive: đọc một README có ví dụ sentinel cũng có thể được tính. Không có liên kết nhãn với file vừa đổi, test case thật hoặc phiên bản code sau sửa.
- Kiểm tra lỗi không đầy đủ: exit code khác 0 nhưng thiếu hai cờ lỗi chính vẫn có thể được tính là pass; không bảo đảm mọi runner thất bại đều bị loại.
- Không xác minh chuỗi đỏ → xanh của `must-change`, xanh → xanh của `must-keep`, cũng không buộc sentinel chạy **sau** lần ghi cuối. Người làm vẫn phải lưu và báo bằng chứng đó.
- Không có cơ chế tự sinh test, chạy test, rollback, giới hạn số nhắc hay lưu state qua restart. Host phải có `agent.steer()` để nhận nhắc.

## 7. Test plugin

Từ gốc workspace:

```bash
cd dsh-eval-gate
node --test test/
```

Hoặc `npm test` trong thư mục plugin. Test policy kiểm tra config, hai loại sentinel và reset; test wiring mô phỏng hook, output, state riêng theo agent và tắt bằng biến môi trường. Kết quả unit test không chứng minh mọi runner/adapter DSH được nhận diện đúng trong phiên thật.

Lấy số `tests`, `pass`, `fail` và exit code từ lần chạy hiện tại, không dựa vào con số kỳ vọng cũ trong README. Nguồn tham chiếu: [policy](lib/policy.js), [wiring](lib/index.js), [package](package.json), [bundle](cordis.patch.yml).
