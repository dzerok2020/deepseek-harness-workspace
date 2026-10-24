# dsh-artifact-review — G5 proposer/reviewer khác modality

Plugin DeepSeek Harness vá khoảng trống **G5**: *thiếu Proposer–Reviewer khác modality*.
Người đề xuất (agent) render artifact rồi tự "nhìn" bằng vision trước khi được phép
tuyên bố xong; nếu chưa nhìn hoặc còn lỗi nặng thì bị nhắc làm lại — có trần số vòng.

## Vì sao cần

Agent viết slide/ảnh/PDF xong thường tự chấm "đạt" mà chưa từng render ra để xem.
Lỗi chỉ lộ khi người dùng mở file: chữ tràn khung, ảnh thiếu, layout lệch, encoding sai.
Plugin này buộc vòng lặp **render → nhìn → ghi chú có cấu trúc → sửa**, và chặn
việc "tự accept khi chưa nhìn" ngay ở tầng policy.

## Cách hoạt động

Hai seam của DSH:

| Seam | Việc làm |
| --- | --- |
| `tools/post-execute` | Thấy tool render (`render_artifact`, `screenshot`, `render`, `export_slide`, `capture`) → đánh dấu "đã render". Thấy tool vision (`read_image` hoặc khớp `/(^|[_-])vision|read_image|describe_image|view_image/i`) chạy **thành công** → `noteReviewed()` + `parseFindings()` các dòng `page | kind | severity | detail`. |
| `agent/turn-stopping` | Chưa render → im lặng. Đã render mà verdict khác `accept`/`give-up` → `agent.steer()` một message nhắc, tăng `refusals`. |

`lib/policy.js` là module thuần (không I/O) nên test được bằng unit test;
`lib/index.js` chỉ nối policy vào seam.

### Thứ tự xét verdict (`reviewVerdict`) — điểm dễ sai nhất

1. `requireVision && !state.looked` → **`blind`** ("propogser accepted without a review pass")
2. `blocking.length === 0` → **`accept`**
3. `rounds >= maxRounds` → **`give-up`**
4. còn lại → **`rework`**

Nhánh `blind` **phải đứng trước** nhánh `accept`: nếu đảo lại thì state rỗng
(`{rounds:0, findings:[], looked:false}`) luôn trả `accept` và cổng không bao giờ chạy.
Đây chính là lỗi đã làm 2 test đỏ trước khi sửa.

## Cấu hình

```js
{
  enabled: true,            // tắt hẳn plugin
  maxRounds: 3,             // trần số vòng nhắc → give-up
  blockingSeverity: 'major',// info | minor | major | blocking
  visionTool: 'read_image', // tên tool vision của host
  requireVision: true       // bắt buộc phải nhìn trước khi accept
}
```

Kill-switch môi trường: `DSH_ARTIFACT_REVIEW=off` → `apply()` trả về sớm,
không hook nào được đăng ký.

## Định dạng ghi chú

Vision trả về các dòng có cấu trúc, mỗi dòng một lỗi:

```
page | kind | severity | detail
```

- `page`: số trang / tên slide / `global`
- `kind`: `overflow` | `layout` | `missing` | `contrast` | `truncation` | `encoding` | `stale` | `other`
- `severity`: `info` | `minor` | `major` | `blocking`
- `detail`: mô tả ngắn

## Chạy test

```bash
cd default-workspace/dsh-artifact-review
node --test test/
```

Kỳ vọng: `tests 30 / pass 30 / fail 0` (19 policy + 11 wiring).

## Lưu ý tích hợp

- Workspace **không có** plugin `dsh-vision-router`; spec gọi tên nó nhưng package
  đó không tồn tại ở đây, nên vision được gọi qua **tool seam** (`cfg.visionTool`),
  suy giảm êm khi host không có tool đó.
- Payload tool trong DSH nằm ở `output` / `result.output`, **không** ở `content` —
  `textOf()` trong `lib/index.js` đọc cả ba. Bỏ sót chỗ này thì plugin không bao giờ
  thấy output thật (đúng lỗi từng gặp ở G4).
- Chuỗi `'propogser accepted without a review pass'` giữ nguyên chính tả sai vì
  test wiring khớp nguyên văn.
