# dsh-artifact-review — nhắc nhìn artifact sau khi render

Plugin local cho DeepSeek Harness (DSH), phiên bản `0.1.0`, tương ứng G5. **Artifact** là sản phẩm có thể mở/xem như slide, ảnh, PDF hoặc giao diện. **Render** là tạo bản hiển thị để kiểm tra; **vision** là đọc ảnh bằng công cụ/thị giác của model.

Plugin quan sát tool render và tool vision, thu nhận các dòng lỗi có cấu trúc rồi nhắc agent khi kết thúc lượt. **Plugin không tự render, không tự gọi vision và không khởi tạo một reviewer độc lập.** Agent hiện tại vẫn phải chủ động dùng các tool đó. “Khác modality” nghĩa là xem hình thay vì chỉ suy luận từ code/text, không có nghĩa đã có người/model thứ hai kiểm tra.

## 1. Quy trình dùng được khuyến nghị

1. Tạo artifact bằng công cụ phù hợp.
2. Render thành ảnh/trang xem thật; kiểm tra bản mới nhất, đúng file và đúng trang.
3. Dùng tool vision thật để nhìn ảnh, không chỉ đọc mã nguồn hay tên file.
4. Nếu tool hỗ trợ trả text nhận xét, yêu cầu các dòng `page | kind | severity | detail` như mục 5.
5. Sửa lỗi, render lại và nhìn lại. Giữ bằng chứng ảnh mới nhất và báo trung thực những lỗi chưa giải quyết.
6. Người dùng mở sản phẩm để nghiệm thu. Cổng im lặng **không đồng nghĩa** sản phẩm đúng hoặc đẹp.

Đây là quy trình người làm phải giữ; runtime hiện không buộc đầy đủ thứ tự và quan hệ ảnh–nhận xét như các bước trên.

## 2. Cài, gỡ và restart

Các lệnh này là hướng dẫn cho người quản trị, không tự chạy khi viết/đọc tài liệu:

```bash
dsh plugin --profile web add file:/home/dzerok/Documents/deepseek-harness/default-workspace/dsh-artifact-review
```

Sau khi cài thành công, **restart DSH dùng profile `web`** để nạp plugin. Package local có `private: true` và bundle trong `cordis.patch.yml`.

Gỡ bằng tên package, rồi restart DSH:

```bash
dsh plugin --profile web remove dsh-artifact-review
```

Tắt tạm bằng `DSH_ARTIFACT_REVIEW=off` trong môi trường trước khi khởi động DSH. Chỉ chuỗi `off` được nhận tại `apply()`; biến trong một shell tool không tắt DSH đã chạy.

## 3. Plugin quan sát gì?

| Hook hoặc nhóm tool | Hành vi thực tế |
| --- | --- |
| `tools/post-execute` với `render_artifact`, `screenshot`, `render`, `export_slide`, `capture` | Đánh dấu đã thấy render; không kiểm tra kết quả render thành công hay thất bại. |
| Tool có tên bằng `visionTool` hoặc khớp regex vision | Nếu kết quả chính không có `ok: false` / `isError: true`, đánh dấu đã nhìn và tăng `rounds`; parse nhận xét từ text kết quả. |
| `agent/turn-stopping` chưa thấy tên tool render | Không yêu cầu review. |
| `agent/turn-stopping` đã thấy render | Tính verdict; `blind`/`rework` gửi lời nhắc bằng `agent.steer()`, `accept`/`give-up` reset state và ngừng nhắc. |

Regex nhận vision là `/(^|[_-])vision|read_image|describe_image|view_image/i`; nó có thể khớp cả tên chứa `read_image`, `describe_image`, `view_image`. Tên tool render khớp chính xác, không nhìn vào action/argument: ví dụ một tool đa chức năng có action screenshot nhưng mang tên khác không tự được nhận là render.

Text nhận xét được đọc từ `content` (chuỗi hoặc mảng text), rồi `output`, `text`, hoặc `result.output`. Nếu kết quả chính không cho text thì thử `exec.result`. Chỉ text **kết quả tool vision** được parse; agent gõ bảng nhận xét trong câu trả lời thông thường không tự thêm finding vào state.

State được tách theo đối tượng agent bằng `WeakMap`; lời gọi tool thiếu agent dùng state dự phòng. State không lưu qua restart.

## 4. Cấu hình mặc định chính xác

Object host truyền cho `apply(ctx, rawConfig)` có các khóa sau; bundle đi kèm chỉ đăng ký plugin, chưa đặt override. Cách đặt override trong profile tùy cấu trúc host DSH bạn dùng.

```json
{
  "enabled": true,
  "maxRounds": 3,
  "blockingSeverity": "major",
  "visionTool": "read_image",
  "requireVision": true
}
```

| Khóa | Mặc định | Tác dụng và chuẩn hóa |
| --- | --- | --- |
| `enabled` | `true` | Chỉ `false` tắt plugin hoàn toàn. |
| `maxRounds` | `3` | Ngưỡng số lần vision được tính thành công; số hữu hạn được làm tròn xuống và ép tối thiểu `1`. Không phải trần mọi lần nhắc. |
| `blockingSeverity` | `"major"` | Mức lỗi tối thiểu cản accept: `info`, `minor`, `major`, `blocking` theo thứ tự tăng dần. Chuỗi được trim/chuyển thường; sai thì dùng `major`. |
| `visionTool` | `"read_image"` | Tên vision bổ sung được nhận chính xác, không thay thế regex dự phòng; chuỗi trống/sai kiểu dùng mặc định. |
| `requireVision` | `true` | Chỉ `false` bỏ yêu cầu phải có lượt vision; nếu không có finding cản, có thể accept ngay sau render. |

### Thứ tự verdict — không hiểu nhầm `maxRounds`

1. `requireVision` bật và chưa từng nhìn → `blind`, xét **trước** trần vòng.
2. Không có finding từ ngưỡng cản trở lên → `accept`.
3. Có finding cản và `rounds >= maxRounds` → `give-up`.
4. Còn lại → `rework`.

`rounds` tăng khi tool vision được tính thành công, **không tăng mỗi lần nhắc**. Vì vậy `blind` có thể nhắc không giới hạn nếu vision không chạy/luôn lỗi; `rework` cũng có thể nhắc mãi nếu không có vision thành công bổ sung. Không có `maxRefusals` hay một trần chung cho mọi refusal.

Khi `give-up`, wiring hiện **âm thầm reset state**, không gửi riêng thông báo thất bại/bàn giao cho người dùng. Không được coi ngừng nhắc là “đã sửa hết”; agent phải tự báo lỗi còn lại và chưa nghiệm thu.

## 5. Định dạng finding (ghi nhận lỗi)

Ví dụ text do tool vision trả về:

```text
page 2 | overflow | major | Chữ ở chân trang bị cắt
3 | contrast | minor | Chữ phụ hơi nhạt
```

Các cột là `page`, `kind`, `severity`, rồi `detail` tùy chọn. Parser nhận từ ba ô trở lên; phần detail có thể chứa thêm dấu `|`. Mức lỗi không hợp lệ khiến dòng bị bỏ qua. `kind` không nhận diện được chuyển thành `other`.

- `kind` hỗ trợ: `overflow`, `layout`, `missing`, `contrast`, `truncation`, `encoding`, `stale`, `other`.
- `severity` hỗ trợ: `info`, `minor`, `major`, `blocking`; không phân biệt hoa/thường sau chuẩn hóa.
- Trang được cố parse thành số nguyên không âm; tên slide hoặc `global` không được giữ như nhãn, mà thành trang không xác định (`page ?` trong lời nhắc).
- Detail được trim và cắt tối đa `500` ký tự khi ghi nhận. Dòng không parse được bị bỏ, không suy đoán lỗi.

**Không có finding parse được không chứng minh ảnh sạch lỗi.** Một tool chỉ trả ảnh hoặc text tự do vẫn có thể được tính là đã nhìn; nếu không có finding cản thì verdict có thể accept.

## 6. Giới hạn phải biết

- Không tự dựng pipeline render/reviewer, không chuyển model và không có plugin vision riêng được yêu cầu/cài tự động. Host phải cung cấp tool khả dụng; không có vision không phải “suy giảm êm” được bảo đảm, vì nhánh `blind` có thể tiếp tục nhắc.
- Không ràng buộc review với đường dẫn ảnh, trang hay bản render mới nhất. Vision có thể đã chạy **trước** render hoặc nhìn ảnh khác mà vẫn được tính. Render lại không xóa trạng thái `looked` hay finding cũ.
- Finding được **tích lũy**, không có thao tác “đã sửa” hay thay finding theo vòng. Một lần vision sau không báo lỗi không gỡ finding nặng trước đó; các finding đó có thể giữ cổng ở `rework` cho tới trần `give-up`.
- Một render mới không reset bộ đếm vòng. Tool vision thành công nhưng không render đúng ảnh vẫn tăng vòng; ngược lại tool render thất bại vẫn đánh dấu cần review.
- Cờ lỗi chỉ xét `result.ok` và `result.isError` ở kết quả chính. Exit code, trạng thái lồng và chất lượng nhận xét không được kiểm chứng đầy đủ.
- Không có nhận diện mọi artifact hay mọi screenshot tool. Tạo PDF qua shell, ghi ảnh qua tool khác, hoặc browser screenshot dưới tên tool không thuộc danh sách có thể không bật cổng.
- Unit test chứng minh policy/hook trong fixture, không chứng minh chất lượng thị giác, tính độc lập reviewer hoặc nghiệm thu end-to-end với adapter đang dùng.

## 7. Chạy test và đọc kết quả

Từ gốc workspace:

```bash
cd dsh-artifact-review
node --test test/
```

`npm test` trong thư mục plugin tương đương. Test policy bao gồm config, severity, parser và thứ tự verdict; test wiring mô phỏng nhận render/vision, output, state riêng theo agent và kill-switch. Chạy được trong Node có dependency DSH khả dụng, không cần khởi chạy một reviewer/model thật.

Báo số `tests`, `pass`, `fail` và exit code từ lần chạy thực tế, không lấy số test kỳ vọng làm bằng chứng cài đặt. Nguồn: [policy](lib/policy.js), [wiring](lib/index.js), [package](package.json), [bundle](cordis.patch.yml).
