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

### 4.1 Vì sao gõ `9router` trong terminal lại "command not found"

Vì lúc cài **không dùng `npm install -g`** (mục 3): npm global và cache `~/.npm` đều read-only trong
sandbox DSH. Binary thật chỉ nằm trong workspace:

```
9router-app/node_modules/.bin/9router  ->  ../9router/cli.js
```

Ba cách để có lệnh `9router` (chạy ở **terminal thật**, không qua DSH):

**a) Shim trong `~/.local/bin` — nhanh nhất, không cài lại gì**

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/9router <<'EOF'
#!/usr/bin/env bash
export DATA_DIR=/home/dzerok/Documents/deepseek-harness/default-workspace/9router-data
exec /home/dzerok/.local/share/mise/installs/node/26.8.2/bin/node \
  /home/dzerok/Documents/deepseek-harness/default-workspace/9router-app/node_modules/9router/cli.js \
  --port 20129 --host 127.0.0.1 "$@"
EOF
chmod +x ~/.local/bin/9router
```

Shim đã ghim `--port 20129` nên **không thể vô tình giành 20128** của OmniRoute.

**b) Cài global thật** (terminal thật ghi được vào prefix của mise):

```bash
npm install -g 9router
9router --port 20129 --host 127.0.0.1   # ĐỪNG chạy `9router` trần: mặc định là 20128
```

**c) Không dùng CLI nữa** — để systemd giữ service (mục 5), chỉ mở dashboard.

> ⚠️ `9router --help` ghi `-H, --host <host>  Host to bind (default: 0.0.0.0)` và thực tế `ss` vẫn thấy
> `LISTEN 0 511 0.0.0.0:20129` dù đã truyền `--host 127.0.0.1` → **dashboard lộ ra LAN**; chặn firewall
> nếu máy dùng chung mạng (dashboard giữ API key provider).

> ⚠️ **Giới hạn quan trọng (đã đo, 2026-10-27):** script này chỉ giữ 9router sống trong **lúc
> lệnh bash còn chạy**. Ngay khi lệnh kết thúc, sandbox của DSH (`bwrap --unshare-pid`) dọn sạch
> mọi tiến trình con — kể cả khi đã `setsid` + `nohup` (kiểm chứng: pid 9 có `PPID=1, SID=9`,
> vẫn biến mất sau ≤ 5 giây). Vì vậy **muốn dùng thường trực thì dùng systemd ở mục 5**,
> hoặc tự chạy script trong terminal của bạn.

## 5. Chạy thường trực bằng systemd user (khuyến nghị)

Máy này đã có `omniroute.service`, `hindsight-daemon.service`… đều là **systemd user unit** —
9router đi cùng khuôn đó. Unit mẫu: [`tools/9router.service`](../tools/9router.service)
(port 20129, `DATA_DIR` trong workspace, `Restart=always`).

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
bash tools/9router-service-install.sh            # cài + enable + start + tự kiểm tra 20129 & 20128
bash tools/9router-service-install.sh --status   # trạng thái + 2 cổng + HTTP
bash tools/9router-service-install.sh --uninstall
journalctl --user -u 9router.service -f          # log
```

**Phải chạy ở terminal thật, không qua DSH**: script ghi vào `~/.config/systemd/user/`, mà `$HOME`
là read-only trong sandbox. Trong sandbox `systemctl --user` cũng không kết nối được bus
(`Failed to connect to user scope bus via local transport: No data available`).

Muốn 9router sống cả khi chưa đăng nhập (sau reboot): `sudo loginctl enable-linger $USER`.

## 6. Bằng chứng đã kiểm chứng (2026-10-27)

> Các số dưới đây đo **trong lúc lệnh bash còn chạy**. Đọc kèm mục 5 + mục 7: cùng một lệnh thì
> 9router phục vụ HTTP thật, nhưng hết lệnh là tiến trình bị dọn.

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

## 7. Giới hạn đã biết

- **Chưa cấu hình provider/API key nào** trong 9router — DB `9router-data/db/data.sqlite` còn trống,
  mới dừng ở mức "chạy được, mở được dashboard, tạo được tài khoản". Muốn dùng thật thì thêm key
  trong dashboard (Settings → Providers).
- **Tiến trình sinh ra trong lệnh bash của DSH không thể tin được** — đo 2026-10-27 thấy **hai** kiểu
  hỏng, cả hai đều không dùng được cho service thường trực:
  1. Bị dọn khi lệnh kết thúc: pid 9 (đã `setsid`, `PPID=1, SID=9`) biến mất trong ≤ 5 giây;
     một instance chạy như background job của DSH sống lâu hơn nhưng bị `SIGKILL` (exit 137) khi job bị thu hồi.
  2. **Sống dư (orphan) nhưng vô hình**: khởi động bằng `… &` trong một lệnh bị `SIGKILL` → tiến trình
     con vẫn chạy, **vẫn listen cổng**, mà `ps`/`fuser`/`pkill` trong lệnh bash sau **không thấy**
     (PID namespace riêng, network namespace dùng chung). Không dừng được từ trong DSH.
  Kết luận: **đừng trông vào `tools/9router-start.sh` để có service thường trực.** Dùng systemd (mục 5),
  hoặc chạy script trong terminal thật của bạn.
- **9router bind `0.0.0.0`, không phải `127.0.0.1`** dù đã truyền `--host 127.0.0.1` (quan sát qua `ss`:
  `LISTEN 0 511 0.0.0.0:20129`). Nghĩa là máy khác trong LAN có thể vào dashboard nếu firewall cho phép.
  Dashboard này giữ API key của provider → nên chặn bằng firewall (`ufw deny 20129`) hoặc chỉ tin mạng nội bộ.
- `systemctl --user` **không dùng được trong sandbox** (`Failed to connect to user scope bus via
  local transport: No data available`) → việc cài unit phải do bạn chạy ở terminal ngoài.
- Dọn một instance orphan (chạy ở terminal thật):
  ```bash
  ss -tlnp | grep 20129          # lấy PID đang giữ cổng
  pgrep -af 9router/cli          # liệt kê cho chắc
  kill <PID>                     # KHÔNG dùng pkill -f "…cli.js" ngay trong shell đang gõ lệnh đó
  ```

## 8. Gỡ

```bash
bash tools/9router-service-install.sh --uninstall   # nếu đã cài systemd unit
bash tools/9router-start.sh --stop                  # nếu đang chạy kiểu script
rm -rf 9router-app 9router-data
```