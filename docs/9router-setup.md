# 9router — cài đặt cục bộ, chạy song song với OmniRoute (không xung đột)

Ngày cài: 2026-10-27. Người dùng yêu cầu: đọc tài liệu [decolua/9router](https://github.com/decolua/9router),
cài đặt, cài luôn môi trường nếu thiếu, và **tuyệt đối không làm hỏng OmniRoute local đang dùng**.

## 1. 9router là gì

AI router / gateway (MIT): gom nhiều provider (40+ provider, 100+ model) về **một endpoint
tương thích OpenAI/Claude**, để các CLI như Claude Code, Cursor, Codex, OpenCode… trỏ vào một chỗ.
Tính năng chính theo README: RTK token saver (nén `tool_result`, tiết kiệm 20–40% token),
auto-fallback (subscription → cheap → free), multi-account round-robin, dashboard quản lý quota.

Bản cài: `9router@0.5.111`, Node `v26.8.2`, npm `11.19.1`.

## 2. Điểm xung đột phải né (quan trọng nhất)

> ⚠️ **Port mặc định của 9router là 20128 — trùng đúng port OmniRoute local
> (`http://127.0.0.1:20128`) mà DSH đang dùng.** Cài theo hướng dẫn gốc
> (`npm i -g 9router && 9router`) sẽ giành port và làm chết route `or` của DSH.

Cách ly đã chọn:

| Hạng mục | OmniRoute (giữ nguyên) | 9router (mới) |
|---|---|---|
| Port | `127.0.0.1:20128` | **`127.0.0.1:20129`** |
| Thư mục dữ liệu | riêng của OmniRoute | `9router-data/` (qua biến `DATA_DIR`) |
| Cấu hình | không sửa gì | `~/.9router` **không dùng** (bị sandbox chặn ghi) |

Không sửa `~/.dsh/profiles/web/cordis.patch.yml`, không đổi `OR_API_KEY`, không đổi route `or`.

## 3. Cài đặt (không dùng `npm -g`)

`npm install -g` và cache mặc định `~/.npm` đều **read-only** trong sandbox của DSH
(`npm error EROFS: read-only file system`). Vì vậy cài kiểu "project-local prefix" ngay trong workspace:

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
npm install --prefix 9router-app 9router
```

Kết quả: `9router-app/node_modules/9router` (~74 MB). Đã gitignore `9router-app/` và `9router-data/`
(node_modules nặng + data chứa `jwt-secret`, `cli-secret`, sqlite → không được commit).

Runtime deps (sqlite native, mitm…) do 9router tự cài vào `$DATA_DIR/runtime/` ở lần chạy đầu —
lần đầu khởi động cần mạng; nếu offline nó sẽ báo thiếu `node_modules` trong `9router-data/runtime/`.

## 4. Chạy / dừng

```bash
bash tools/9router-start.sh            # khởi động nền trên 127.0.0.1:20129
bash tools/9router-start.sh --status   # xem 9router + OmniRoute còn sống không
bash tools/9router-start.sh --stop     # dừng
```

Script tự đặt `DATA_DIR=9router-data`, ghi log `9router-data/logs/9router-server.log`,
ghi pid `9router-data/9router.pid`, và **từ chối khởi động nếu port đã bận** (không bao giờ
giết tiến trình đang chiếm port). Hai biến môi trường tuỳ chọn: `NINEROUTER_PORT`, `NINEROUTER_DATA`.

> Tên biến **không thể** bắt đầu bằng chữ số (`9ROUTER_PORT` là bash identifier không hợp lệ) —
> đây là lỗi thật gặp khi viết script, đã đổi thành `NINEROUTER_*`.

Dashboard: <http://127.0.0.1:20129/dashboard> → tự chuyển `/login`. Lần đầu tạo tài khoản admin
ngay trên web (không có mật khẩu mặc định trong repo).

## 5. Bằng chứng đã kiểm chứng (2026-10-27)

```
$ bash tools/9router-start.sh --status
9router ĐANG CHẠY tại http://127.0.0.1:20129
OmniRoute 20128: vẫn sống (không bị ảnh hưởng)

$ curl -sL -o /dev/null -w "%{http_code} %{url_effective}\n" http://127.0.0.1:20129/
200 http://127.0.0.1:20129/login

$ curl -sL -o /dev/null -w "%{http_code} %{url_effective}\n" http://127.0.0.1:20128/login
200 http://127.0.0.1:20128/login
```

Test vòng đời đầy đủ trên port tạm 20130 + data tạm (để không đụng instance thật):

```
$ NINEROUTER_PORT=20130 NINEROUTER_DATA=$PWD/9router-data-test bash tools/9router-start.sh
9router đã lên: http://127.0.0.1:20130/dashboard  (pid 10, log .../9router-data-test/logs/9router-server.log)
$ curl -sL -o /dev/null -w "%{http_code}\n" http://127.0.0.1:20130/     → 200
$ bash tools/9router-start.sh --status  → ĐANG CHẠY / OmniRoute vẫn sống
$ bash tools/9router-start.sh --stop    → Đã dừng 9router (pid 10).
$ ss -tln | grep -c ':20130 '           → 0   (port đã đóng)
```

Log khởi động thật: `🚀 9router v0.5.111 / Server: http://127.0.0.1:20130 / ▲ Next.js 16.4.2`.

## 6. Giới hạn đã biết

- **Chưa cấu hình provider/API key nào** trong 9router — DB `9router-data/db/data.sqlite` còn trống,
  mới dừng ở mức "chạy được, mở được dashboard, tạo được tài khoản". Muốn dùng thật thì thêm key
  trong dashboard (Settings → Providers).
- **PID namespace**: lệnh bash của DSH chạy trong `bwrap --unshare-pid`, nên tiến trình do một lệnh
  bash khởi động **không nhìn thấy** từ lệnh bash khác (`pgrep`/`kill`/`pkill` đều không thấy), dù nó
  vẫn phục vụ HTTP bình thường. Hệ quả: hãy chạy `start` và `stop` từ **cùng một nơi** (terminal của bạn).
  Nếu instance đang chạy không có pidfile, `--stop` sẽ thử `pkill -f <đường dẫn cli.js tuyệt đối>`
  (chỉ khớp đúng 9router này, không đụng tiến trình khác).
- Instance đang chạy hiện tại được khởi động thủ công trước khi script hoàn thiện → chưa có pidfile;
  dừng nó bằng `pkill -f "9router-app/node_modules/9router/cli.js"` rồi chạy lại script nếu muốn quản lý bằng pidfile.

## 7. Gỡ

```bash
bash tools/9router-start.sh --stop
rm -rf 9router-app 9router-data
```