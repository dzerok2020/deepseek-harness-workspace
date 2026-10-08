# Báo cáo: vòng lặp "Chưa có yêu cầu mới", sức khoẻ hệ thống, và tối ưu vibe code

Ngày: 2026-10-08 · Máy của bạn · DSH `0.2.0-rc.2` · Profile `web`

Báo cáo này trả lời đúng 3 việc bạn yêu cầu:

1. Vì sao bị vòng lặp khi vibe code, và đã sửa thế nào.
2. Quét toàn bộ hệ thống DSH: tìm thấy lỗi/xung đột gì, đã sửa gì, còn gì.
3. Hệ thống đã được tối ưu cho vibe code chưa, còn thiếu gì.

Muốn xem nhanh "việc của bạn cần làm": nhảy tới **§1.4** (một lệnh duy nhất).

---

## 1. Vòng lặp "Chưa có yêu cầu mới — mình đang chờ bạn nhé"

### 1.1. Chuyện gì thật sự xảy ra (giải thích cho người mới)

Mỗi bước, DSH gửi cho model một gói ngữ cảnh mới gọi là **runtime context** — nó
được ghi vào lịch sử như một tin nhắn người dùng. Trong gói đó có một khối
"nhắc lại đoạn hội thoại gần đây" (`lingshu:session-window`). Khối này **chứa
chính câu trả lời cuối cùng của model**, nên nội dung của nó đổi sau mỗi bước.

Kết quả là bức tranh model nhìn thấy **khác đi sau từng bước**, dù bạn không gõ
gì. Model trả lời bằng một câu văn (không gọi công cụ nào) → harness coi đó là
một bước mới → lại gửi runtime context mới → lại "Chưa có yêu cầu mới". Đó là
vòng lặp bạn thấy, và nó chỉ dừng khi bạn gõ vào.

Bằng chứng đo được trên máy bạn:

| Bằng chứng | Giá trị |
|---|---|
| Session lỗi nặng nhất `session-d93fa255-93ba-4b7c-8a19-1c8a79db506a.json` | 1 turn / **237 step**, mà chỉ có **1 tin nhắn thật** của bạn |
| Session điều tra | 1 turn / **~157 step**, 1 tin nhắn thật |
| Số tin `runtime-context` được ghi thêm | **161 bản** trong 1 turn |
| Khác nhau giữa 2 bản liên tiếp | **đúng 1 dòng** — dòng `[assistant]` trong khối nhắc lại |
| Khối duy nhất thay đổi | `lingshu:session-window` và `lingshu:auto-recall` |

Quan trọng: **không phải** lỗi của `goal`, của guardian, của `aegis`, hay của
auto-review — mình đã loại trừ từng cái bằng bằng chứng cụ thể.

### 1.2. Cách sửa

Mình viết một plugin nhỏ **`dsh-loop-guard`** (trong
`dsh-loop-guard/`, ~300 dòng + test). Nó làm đúng một việc:

> Trong một turn, **đóng băng** nội dung 2 khối `lingshu:*` ở bản đầu tiên, giữ
> nguyên cho mọi bước sau. Chỉ mở băng khi có **turn mới thật** hoặc **tin nhắn
> thật của bạn**.

Mấu chốt là phải phân biệt *tin thật* với *tin do hệ thống tiêm vào* (chúng đều
đi qua sự kiện `user/message`): tin có `source.kind` khác `'user'` là tin tiêm ⇒
không được mở băng. Bản đầu của guard thiếu đúng phép kiểm tra này nên `freezes`
luôn = 0 — tức guard **không** chữa được ca lỗi cần chữa.

- Test: `node --test test/` trong `dsh-loop-guard/` → **21/21 xanh**, trong đó có
  test tái hiện lỗi gốc (không guard ⇒ turn không bao giờ đóng; có guard ⇒ đóng
  ngay bước thứ 2).

### 1.3. Sửa thêm một lỗi phụ liên quan

`dsh-vibe-guard` (plugin nhắc bạn "nhớ chạy verify") bắn cảnh báo **giả**: regex
của nó coi `2>/dev/null` là dấu hiệu "đã sửa file", nên những lệnh **chỉ đọc**
cũng bị tính là thay đổi. Đã sửa regex và thêm test hồi quy: **26/26 xanh**.

### 1.4. ⚠️ VIỆC BẠN CẦN LÀM: khởi động lại DSH

DSH chỉ đọc plugin lúc khởi động. **Tắt và mở lại DSH** (đúng cách bạn vẫn mở
nó), rồi kiểm tra:

```bash
cat ~/.dsh/loop-guard-status.json
```

- `"freezes": 0` ⇒ **chưa** vào việc (thường là chưa restart, hoặc bản cài bị
  ghi đè — xem §2.3).
- `"freezes"` **> 0** và tăng dần trong lúc bạn làm việc ⇒ đúng như thiết kế.

Nếu có gì bất thường, tắt tạm để loại trừ rồi restart:

```bash
# trong file khởi động DSH, thêm biến môi trường:
DSH_LOOP_GUARD=off
```

---

## 2. Quét toàn hệ thống DSH

### 2.1. Kết quả tổng

Lệnh kiểm tra sức khoẻ mình viết cho bạn: `bash tools/dsh-health.sh`
(chỉ đọc, không sửa gì) — hiện tại **20 ĐẠT / 0 LỖI**.

### 2.2. Đã tìm thấy và đã sửa

| # | Vấn đề | Mức độ | Đã xử lý |
|---|---|---|---|
| 1 | Hai bản `@deepseek-ai/dsh-skill-filesystem` (0.1.1-rc.2 lồng trong 0.2.0-rc.2) khiến runtime **tắt mọi row** dùng gói đó ⇒ **skill cục bộ không vào được catalog** | Cao | Thêm `overrides` trong `~/.dsh/profiles/web/pnpm-workspace.yaml` ghim `0.2.0-rc.2` |
| 2 | `@openviking/dsh-memory-plugin@0.5.16` khai peer `>=0.1.0-rc.6 <0.2.0` ⇒ không chứa bản 0.2.x | Trung bình | Nâng `0.5.19` (peer `>=0.1.0-rc.6 <1.0.0-0`) |
| 3 | **Plugin cục bộ bị pnpm sao chép thay vì symlink** ⇒ sửa code trong workspace **không có tác dụng** (đã xảy ra thật với `dsh-loop-guard` và `dsh-vibe-guard`: bản chạy là code cũ) | **Cao** (âm thầm) | Chuyển cả 3 plugin sang symlink + thêm script kiểm tra/sửa + mục 7 trong health check |
| 4 | Lỗi `cannot create effect on inactive context` trong `~/.dsh/logs/dsh-memory-apply-error.log` | Thấp | Chỉ xảy ra khi hot-reload (04–05/10), **không có lần nào sau đó** ⇒ không phải vấn đề đang sống |
| 5 | Log `startup-2026-10-04…`: `1 required plugin did not activate` (thiếu service `tools`) | Đã hết | Cùng nguyên nhân #1; không có log startup nào sau 04/10 |

### 2.3. Đã dựng cơ chế chống tái phát

```bash
bash tools/dsh-health.sh              # 8 mục: phiên bản, cấu hình, bundle, gói lồng, skill, test, symlink, Git
bash tools/sync-local-plugins.sh      # kiểm tra 3 plugin cục bộ có phải symlink đúng không
bash tools/sync-local-plugins.sh --fix   # sửa nếu lệch (tự sao lưu bản cũ vào /tmp rồi kiểm tra lại)
```

**Chạy `sync-local-plugins.sh` sau mỗi lần cài/gỡ plugin** — vì `pnpm install` có
thể ghi đè symlink bằng bản sao cũ. Health check mục 7 sẽ tự báo động.

### 2.4. Còn lại — chỉ một, và không bắt buộc

`pnpm outdated` cho thấy **chỉ một gói lỗi thời**:

```
stratagate-dsh   0.3.4 → 0.3.5   (bản mới phát hành 2026-10-08)
```

Đây là plugin bộ nhớ 6 lớp + knowledge graph. Mình **không tự nâng** vì nó đang
phục vụ chính phiên này; nếu bạn muốn:

```bash
dsh plugin --profile web add stratagate-dsh@0.3.5
bash tools/sync-local-plugins.sh --fix   # để chắc chắn 3 plugin cục bộ còn là symlink
# rồi restart DSH
```

*(Lưu ý: thông báo `plugin command failed; diagnostics: …/pnpm.log` khi chạy
`outdated` chỉ là do pnpm trả mã 1 khi có gói lỗi thời — không phải lỗi cài đặt.)*

---

## 3. Vibe code đã được tối ưu tới đâu

### 3.1. Đang có (đã kiểm chứng trên máy bạn)

| Hạng mục | Trạng thái |
|---|---|
| Git cho workspace | ✅ 5 commit, worktree sạch, `.gitignore` đủ (bỏ `node_modules/`, log, file nặng của `video_analysis/`) |
| Hợp đồng cho AI (`AGENTS.md`) | ✅ 2 tầng: `~/.dsh/AGENTS.md` (mọi dự án) + `AGENTS.md` cấp dự án (quy trình, Definition of Done, kỷ luật Git) |
| Buộc AI tự test trước khi giao | ✅ Ghi trong Definition of Done: phải **dán nguyên văn** kết quả test; UI phải có screenshot desktop + mobile; chưa chạy được thì phải ghi "chưa verify" |
| Kiểm tra sức khoẻ định kỳ | ✅ `tools/dsh-health.sh` (20 ĐẠT/0 LỖI) |
| Chống vòng lặp | ✅ `dsh-loop-guard` (chờ restart) |
| Chống cảnh báo verify giả | ✅ `dsh-vibe-guard` (regex đã sửa) |
| Kho skill cá nhân | ✅ 78 skill trong `~/.dsh/skills`; AI tự gọi skill khớp việc |
| Cẩm nang cho người mới | ✅ `docs/vibe-code-cho-nguoi-moi.md` — quy trình 5 bước, lộ trình 3 cấp, từ điển 60 giây |
| Khuôn dự án mới | ✅ `tools/new-project.sh` + `tools/templates/` — tạo dự án mới là có ngay Git + `.gitignore` + `AGENTS.md` + commit đầu tiên |

### 3.2. Việc nên làm tiếp (theo thứ tự đáng làm nhất)

1. **Đẩy Git lên remote** — hiện 5 commit chỉ nằm trên máy; hỏng ổ là mất hết.
   ```bash
   gh repo create default-workspace --private --source . --push
   ```
   (hoặc tạo repo trống trên GitHub rồi `git remote add origin … && git push -u origin master`).
2. **Mỗi dự án mới có test chạy được** (`npm test` / `pnpm test` / `node --test`).
   Definition of Done chỉ có sức mạnh khi tồn tại một lệnh test. Bắt đầu dự án mới:
   ```bash
   bash tools/new-project.sh ~/Documents/du-an-moi
   ```
3. **Bật hook chạy health check trước mỗi commit** (tuỳ chọn, mình chưa cài vì
   bạn nên tự quyết):
   ```bash
   printf '#!/bin/sh\nbash "$(git rev-parse --show-toplevel)/tools/dsh-health.sh" >/dev/null || { echo "Health check FAIL - xem chi tiet: bash tools/dsh-health.sh"; exit 1; }\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
   ```
4. **Sau mỗi lần sửa plugin cục bộ**: `bash tools/sync-local-plugins.sh` rồi restart DSH.
5. **Lên Cấp 2 của lộ trình** — không còn "duyệt tin AI" mà đọc được diff: xem
   `docs/vibe-code-cho-nguoi-moi.md` §4 Cấp 2.

### 3.3. Bảng lệnh nhanh

| Muốn gì | Gõ gì |
|---|---|
| Kiểm tra hệ thống lành không | `bash tools/dsh-health.sh` |
| Kiểm tra/sửa plugin cục bộ | `bash tools/sync-local-plugins.sh [--fix]` |
| Xem guard chống lặp có làm việc | `cat ~/.dsh/loop-guard-status.json` (chờ `freezes` > 0) |
| Tắt guard chống lặp tạm thời | thêm `DSH_LOOP_GUARD=off` khi khởi động DSH |
| Tắt cảnh báo verify tạm thời | thêm `DSH_VIBE_GUARD=off` |
| Tạo dự án mới đúng chuẩn | `bash tools/new-project.sh <đường-dẫn>` |
| Xem gói lỗi thời | `dsh plugin --profile web outdated` |
