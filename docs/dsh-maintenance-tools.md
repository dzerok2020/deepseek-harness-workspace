# Hai công cụ bảo trì DSH và mạng Waydroid

Tài liệu tiếng Việt cho người mới, đối chiếu trực tiếp với mã nguồn [dsh-update.sh](../tools/dsh-update.sh) và [fix-waydroid-net.sh](../tools/fix-waydroid-net.sh). Đây là hướng dẫn thao tác thủ công, **không phải lời xác nhận hai script đã được chạy hay hệ thống đang hoạt động tốt**.

## 1. Chọn đúng công cụ và hiểu ranh giới

| Công cụ | Mục đích | Nơi có thể bị thay đổi | Quyền chạy |
| --- | --- | --- | --- |
| [dsh-update.sh](../tools/dsh-update.sh) | Cài CLI DSH và đồng bộ dependency của profile `web` về phiên bản cố định | Gói npm toàn cục; profile tại `~/.dsh/profiles/web`; backup tại `~/.dsh/backups` | Người dùng sở hữu bản cài DSH và profile |
| [fix-waydroid-net.sh](../tools/fix-waydroid-net.sh) | Thử xử lý mạng Waydroid khi UFW chặn gói chuyển tiếp trên Arch/Omarchy | IPv4 forwarding của máy; cấu hình UFW; dịch vụ container Waydroid | `root`, thường qua `sudo` |

**Không chạy một trong hai chỉ vì “có vẻ cần bảo trì”.** Đọc trạng thái hiện tại và xác định đúng vấn đề trước. Không dùng script Waydroid để xử lý lỗi DSH, và không dùng updater để tìm bản DSH mới nhất.

- CLI là chương trình gọi từ terminal; profile là tập cấu hình và plugin của một môi trường DSH.
- Dependency là gói phần mềm phụ thuộc. Override buộc dependency dùng một phiên bản cụ thể.
- Rollback là khôi phục về trạng thái cũ; cả hai script đều **không cung cấp rollback toàn hệ thống**.
- Dùng **terminal ngoài phiên DSH** để tự thực hiện các lệnh thay đổi bên dưới. Updater có thể thay chính chương trình đang phục vụ phiên AI; script Waydroid cần quyền quản trị hệ thống. Không yêu cầu agent tự chạy chúng.
- Các khối lệnh là những bước riêng biệt, không phải một khối để dán chạy hết từ đầu đến cuối. Chỉ chạy phần phù hợp sau khi đọc cảnh báo.

## 2. Updater DSH: phiên bản được ghim, không phải “latest”

### 2.1. Nó thực sự làm gì?

Mã nguồn đặt cố định:

```bash
NEW_VERSION="0.2.1-rc.2"
OLD_VERSION="0.2.0-rc.2"
PROFILE_DIR="$HOME/.dsh/profiles/web"
```

`rc` là bản ứng viên phát hành, không đồng nghĩa với bản ổn định. Script không hỏi npm xem phiên bản nào mới nhất, không tự suy ra phiên bản cũ từ máy và không hỗ trợ chọn profile khác bằng tham số. Nếu máy đang dùng bản mới hơn hoặc khác hai phiên bản trên, **dừng lại để đánh giá**, vì chạy script vẫn có thể đưa CLI về `0.2.1-rc.2`.

Thứ tự nhánh cập nhật:

1. Kiểm tra có `dsh` và `pnpm` trong `PATH` (danh sách nơi shell tìm chương trình); đọc `dsh --version` và bỏ toàn bộ khoảng trắng.
2. Nếu chuỗi phiên bản đã bằng đúng `0.2.1-rc.2`, thoát ngay, **không kiểm tra hay sửa dependency profile**.
3. Nếu phát hiện listener tại `127.0.0.1:3080` qua `ss`, cảnh báo và hỏi `Tiếp tục? [y/N]`. Chỉ `y` hoặc `Y` tiếp tục. Đây không phải phép phát hiện mọi tiến trình DSH: cổng/địa chỉ khác có thể bị bỏ sót; tiến trình khác cũng có thể chiếm cổng này.
4. Tạo `~/.dsh/backups/dsh-update-YYYYMMDD-HHMMSS` rồi sao chép bốn file: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `cordis.patch.yml`.
5. Chạy `npm install -g @deepseek-ai/dsh@0.2.1-rc.2`.
6. Dùng `sed` thay đúng chuỗi phiên bản `0.2.0-rc.2` của `@deepseek-ai/dsh-skill-filesystem` trong `pnpm-workspace.yaml` và `package.json` thành `0.2.1-rc.2`.
7. Kiểm tra file workspace có chứa chuỗi phiên bản mới rồi chạy `pnpm install` trong profile `web`.
8. In phiên bản CLI, thử liệt kê dependency, đếm số đường dẫn `package.json` của `dsh-skill-filesystem` dưới `node_modules`. Script yêu cầu số đếm bằng `1` và CLI bằng đúng phiên bản mới.

Kiểm tra bằng `grep` chỉ tìm chuỗi phiên bản mới trong file workspace, không xác thực toàn bộ cấu hình hay bảo đảm mọi phép thay thế đều thành công. Số đếm `1` là kiểm tra hẹp cho gói filesystem, **không chứng minh tất cả plugin tương thích**.

### 2.2. Điều kiện trước khi cập nhật

- Có Bash và các lệnh được dùng: `dsh`, `npm`, `pnpm`, `date`, `tr`, `ss`, `grep`, `sed`, `cp`, `mkdir`, `find`, `wc`, `ls`, `head`. Cú pháp `sed -i` của script phù hợp môi trường Linux hiện tại; đừng mặc định chạy nguyên bản trên mọi hệ điều hành.
- Có kết nối tới nguồn gói npm/pnpm, đủ dung lượng và quyền ghi vào nơi npm cài toàn cục cùng profile `web`.
- Bốn file profile cần sao lưu đã tồn tại và đọc được. Script không tự tạo profile thiếu.
- Biết cách dừng và khởi động lại DSH đang dùng; lưu công việc đang mở trước.
- Không chạy bằng `sudo` theo thói quen. `HOME` của tài khoản chạy quyết định profile được chọn; dùng sai tài khoản có thể tác động nhầm profile hoặc gây lỗi quyền sở hữu.

Đọc trạng thái từ terminal ngoài DSH, chưa cập nhật:

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
command -v dsh npm pnpm
which -a dsh
dsh --version
npm prefix -g
ls -l "$HOME/.dsh/profiles/web/"{package.json,pnpm-workspace.yaml,pnpm-lock.yaml,cordis.patch.yml}
ss -ltnp
```

Đối chiếu phiên bản và nơi cài trước khi đi tiếp. Nếu có nhiều `dsh` trong `PATH`, cần biết shell đang gọi bản nào; cài npm toàn cục không nhất thiết thay đúng binary đứng đầu `PATH`.

### 2.3. Sao lưu và chạy thủ công

Dừng DSH bằng cách đã dùng để khởi động nó (ví dụ `Ctrl+C` tại terminal chạy `dsh web`). Không chỉ đóng tab trình duyệt: server có thể vẫn chạy. Mở terminal khác để cập nhật.

Backup tự động chỉ chứa bốn file, không chứa toàn bộ profile, `node_modules`, dữ liệu phiên, credential hay gói CLI toàn cục. Hãy ghi lại phiên bản CLI ban đầu và đường dẫn backup được script in ra. Có thể lưu thêm bản sao độc lập của profile trước khi thay đổi; không coi Git trong workspace là backup cho dữ liệu ở `~/.dsh`.

**Lệnh có thay đổi hệ thống — chỉ tự chạy khi đã kiểm tra và chấp nhận phạm vi:**

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
bash tools/dsh-update.sh
```

Nếu script vẫn hỏi tiếp tục khi cổng 3080 đang mở, lựa chọn an toàn là trả lời `N`, kiểm tra tiến trình rồi dừng đúng DSH trước. Không vượt cảnh báo chỉ để script chạy hết.

### 2.4. Kiểm chứng sau cập nhật

Sau khi script thành công, khởi động lại DSH bằng cách thông thường. Ví dụ nếu trước đó bạn trực tiếp chạy CLI:

```bash
dsh web
```

Ở terminal khác, tại workspace:

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
dsh --version
(cd "$HOME/.dsh/profiles/web" && pnpm list "@deepseek-ai/dsh-skill-filesystem" --depth 0)
bash tools/dsh-health.sh
```

Mong đợi CLI là `0.2.1-rc.2`, script báo đúng một bản filesystem và health không báo lỗi cần xử lý. Mở GUI, kiểm tra profile/plugin thực tế và một thao tác quen thuộc. Health là kiểm tra bổ sung được updater khuyến nghị; nó không được updater tự chạy và cũng không thay thế nghiệm thu của người dùng.

### 2.5. Lỗi và trạng thái dở dang

Script dùng `set -euo pipefail`: nhiều lỗi sẽ làm nó dừng, **không tự hoàn tác các bước đã ghi**. Đây không phải cập nhật transactional (giao dịch kiểu “hoặc tất cả thành công, hoặc không thay gì”).

| Dấu hiệu | Ý nghĩa và bước an toàn tiếp theo |
| --- | --- |
| Không thấy `dsh` hoặc `pnpm` | Sửa môi trường/PATH trước; đừng chạy tiếp bằng tài khoản khác để né lỗi |
| Không sao chép được file backup | Backup có thể thiếu; kiểm tra từng file trước khi xem đó là điểm khôi phục |
| npm lỗi quyền hoặc tải gói thất bại | Kiểm tra trạng thái CLI thực tế; đừng mặc định chưa có thay đổi và đừng tự thêm `sudo` |
| `sed không đổi được override` | CLI có thể đã đổi; so sánh cấu hình với backup, không restart vội |
| `pnpm install` lỗi | Profile có thể đã sửa nhưng dependency chưa hoàn chỉnh; lưu nguyên văn lỗi để chẩn đoán |
| Số bản filesystem khác `1` | Script dừng và yêu cầu không restart vội; xem lại override và dependency |
| CLI vẫn không đúng phiên bản | Kiểm tra nhiều binary/PATH và nguồn cài; không lặp cập nhật mù quáng |

Lệnh `pnpm list` có nhánh thông báo dự phòng; chỉ thấy dòng hiển thị không có nghĩa mọi thứ đã ổn. Chạy lại các kiểm tra riêng để thấy mã lỗi và output đầy đủ. Không chia sẻ toàn bộ cấu hình nếu có API key hay thông tin đăng nhập.

### 2.6. Rollback tự động: giới hạn quan trọng

**Lệnh này cũng thay đổi hệ thống; dừng DSH trước và kiểm tra backup rồi mới chạy:**

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
ls -ldt "$HOME"/.dsh/backups/dsh-update-*
bash tools/dsh-update.sh --rollback
```

Nhánh `--rollback`:

1. Chọn backup đứng đầu kết quả `ls -1dt`, tức **mới nhất theo thời gian sửa đổi thư mục**, không cho chọn backup cụ thể. Một lần cập nhật lỗi vẫn có thể tạo thư mục backup mới nhất nhưng thiếu file.
2. Cài CLI cố định `0.2.0-rc.2`, **không phải phiên bản thật trước lần cập nhật**.
3. Chỉ chép lại `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, rồi chạy `pnpm install`.
4. **Không chép lại `cordis.patch.yml`, dù file này có trong backup.**

Vì vậy, rollback không khôi phục toàn bộ profile, không khôi phục mọi dữ liệu và không đảo ngược hoàn hảo thay đổi dependency. Nó cũng không transactional: npm/copy/pnpm có thể lỗi giữa chừng. Không dùng `--rollback` để chọn một backup cũ hơn bằng cách thêm đường dẫn: mã nguồn không có giao diện đó.

Nếu cần khôi phục một backup cụ thể hoặc file `cordis.patch.yml`, thực hiện thủ công sau khi dừng DSH, sao lưu riêng trạng thái hiện tại và so sánh nội dung. Ví dụ sau đây **ghi đè cấu hình**, không chạy khi chưa thay đường dẫn mẫu bằng thư mục thực đã kiểm tra:

```bash
PROFILE_DIR="$HOME/.dsh/profiles/web"
BACKUP_DIR="$HOME/.dsh/backups/dsh-update-YYYYMMDD-HHMMSS"
ls -l "$BACKUP_DIR/"{package.json,pnpm-workspace.yaml,pnpm-lock.yaml,cordis.patch.yml}
diff -u "$PROFILE_DIR/cordis.patch.yml" "$BACKUP_DIR/cordis.patch.yml"
```

`diff` trả mã `1` khi có khác biệt; đây không nhất thiết là lỗi công cụ. Chỉ khi đã chọn đúng backup và quyết định phục hồi **cả bốn file**, chạy từng bước và dừng nếu có lỗi:

```bash
cp "$BACKUP_DIR/package.json" "$PROFILE_DIR/package.json"
cp "$BACKUP_DIR/pnpm-workspace.yaml" "$PROFILE_DIR/pnpm-workspace.yaml"
cp "$BACKUP_DIR/pnpm-lock.yaml" "$PROFILE_DIR/pnpm-lock.yaml"
cp "$BACKUP_DIR/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"
(cd "$PROFILE_DIR" && pnpm install)
```

Các lệnh copy này không đổi CLI. Nếu phải khôi phục CLI, chọn phiên bản đã ghi nhận trước đó và kiểm tra tương thích với profile; không mặc định dùng `OLD_VERSION` nếu phiên bản cũ thật khác nó. Sau khôi phục, kiểm tra CLI, dependency, restart DSH và chạy health như trên.

## 3. Waydroid: sửa forwarding có ảnh hưởng toàn máy

### 3.1. Giả thuyết của script và ảnh hưởng bảo mật

Chú thích mã nguồn nêu giả thuyết: UFW chặn forward ở priority `-1` trước chain `inet lxc` của Waydroid ở priority `0`, nên gói không tới NAT masquerade priority `100`. Forwarding là chuyển gói **đi xuyên qua máy**; NAT masquerade là đổi địa chỉ nguồn để container dùng kết nối của máy chủ. Đây là giả thuyết cần đối chiếu với firewall thực tế, **không phải chẩn đoán đã được chứng minh trên mọi máy**.

Script yêu cầu UID `0` và thực hiện theo thứ tự:

1. `sysctl -w net.ipv4.ip_forward=1`: bật IPv4 forwarding đang chạy trong kernel.
2. Nếu tìm thấy đúng dòng bắt đầu `DEFAULT_FORWARD_POLICY="DROP"` trong `/etc/default/ufw`, sao lưu bằng `cp -a` thành `/etc/default/ufw.bak.<epoch-seconds>`, rồi đổi dòng đó thành `ACCEPT`.
3. Chạy `ufw reload`.
4. In tối đa 20 dòng table `inet lxc` và 10 dòng table `ip lxc` qua `nft`.
5. Gọi `waydroid session stop`, bỏ qua lỗi của riêng lệnh này; restart `waydroid-container.service`, đợi 5 giây rồi kiểm tra service active.
6. In policy, giá trị sysctl và tối đa 5 dòng trạng thái Waydroid; nhắc người dùng tự kiểm tra Internet.

**Cảnh báo quan trọng:** đổi mặc định UFW từ `DROP` sang `ACCEPT` là thay chính sách forwarding **toàn máy**, không chỉ giao diện Waydroid hay một subnet. Nó có thể ảnh hưởng Docker, VPN, máy ảo và chức năng router. Không được mô tả đây là một rule cho phép riêng Waydroid.

Chú thích script cho rằng INPUT vẫn DROP nên an toàn. Tuy nhiên, mã không kiểm tra INPUT; giữ chặn gói tới máy cũng **không loại bỏ rủi ro mở luồng chuyển tiếp qua máy**. Cần quản trị viên đánh giá firewall hiện tại; nếu cần rule hẹp theo interface/subnet, đó là phương án riêng, không phải tính năng có sẵn trong script này.

Sysctl được thay **tạm thời ở runtime**: script không tạo cấu hình persistent trong `sysctl.conf` hay `sysctl.d`. Sau reboot, giá trị tùy cấu hình hệ thống. Ngược lại, sửa `/etc/default/ufw` là thay đổi trên đĩa và có thể tồn tại qua reboot.

### 3.2. Điều kiện và chẩn đoán an toàn trước khi sửa

Cần Linux có Waydroid đã thiết lập, systemd và service `waydroid-container.service`, UFW, nftables cùng các lệnh `sudo`, `bash`, `id`, `sysctl`, `grep`, `cp`, `date`, `sed`, `head`, `sleep`. Dùng tài khoản có quyền sudo. Script không cài các thành phần này và không kiểm tra đầy đủ trước khi thay đổi bước đầu.

Mở terminal ngoài DSH. Các lệnh sau đọc trạng thái, không bật forwarding hay đổi firewall; một số yêu cầu sudo để đọc đầy đủ:

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
sysctl -n net.ipv4.ip_forward
sudo grep '^DEFAULT_FORWARD_POLICY' /etc/default/ufw
sudo ufw status verbose
systemctl is-active waydroid-container.service
waydroid status
ip address show
ip route show
sudo nft list table inet lxc
sudo nft list table ip lxc
```

Ghi lại **giá trị sysctl cũ chính xác** và policy cũ trước khi chạy; đừng mặc định chúng là `0` và `DROP`. `is-active` có thể trả mã khác `0` khi service không active. Table nft không tồn tại có thể do container chưa chạy, không tự chứng minh nguyên nhân là UFW.

Nếu cần đọc log:

```bash
journalctl -u waydroid-container.service -n 80 --no-pager
```

Xem cả địa chỉ, route, DNS và luật firewall thay vì chỉ thử lại script. Log/địa chỉ mạng có thể nhạy cảm; che dữ liệu riêng trước khi gửi hỗ trợ. Không đưa API key, credential hoặc toàn bộ ruleset lên nơi công khai.

### 3.3. Backup và lệnh chạy có chủ ý

Lưu công việc trong Android: script sẽ dừng session và restart container, có thể đóng ứng dụng hoặc gián đoạn tác vụ. Việc `waydroid session stop` chạy dưới root có thể không dừng đúng session người dùng; lỗi bị bỏ qua. Người dùng nên tự dừng session của mình trước khi gọi script nếu đang mở.

Backup tự động chỉ được tạo khi khớp đúng dòng `DROP`; nếu policy đã khác, file bị thiếu hoặc định dạng không khớp, nhánh sửa có thể bị bỏ qua nhưng script vẫn đi tiếp. Nó **không backup sysctl, ruleset nftables hay trạng thái session/service**. Nếu không chắc có backup phù hợp, tự sao lưu UFW trước bằng một tên duy nhất và ghi lại giá trị sysctl.

Sau khi đã đánh giá rủi ro toàn máy, lệnh sửa thủ công là:

```bash
cd /home/dzerok/Documents/deepseek-harness/default-workspace
sudo bash tools/fix-waydroid-net.sh
```

Không cần làm script executable và không nên dùng `curl | sudo bash`. Đọc lại script tại máy trước khi cấp root.

### 3.4. Kiểm chứng: service active chưa đủ

Script không ping, không kiểm tra DNS, HTTP hoặc Internet từ Android. `systemctl is-active` thành công chỉ cho biết service đang active. In table nft hoặc dòng `XONG` **không chứng minh kết nối đã được khôi phục**. Những pipeline `nft ... | head ...` và `waydroid status | head ...` không bật `pipefail`, nên lỗi ở lệnh đầu có thể không làm script thất bại.

Sau chạy, kiểm tra riêng để không mất output do cắt dòng:

```bash
sysctl -n net.ipv4.ip_forward
sudo grep '^DEFAULT_FORWARD_POLICY' /etc/default/ufw
sudo ufw status verbose
systemctl is-active waydroid-container.service
waydroid status
sudo nft list table inet lxc
sudo nft list table ip lxc
```

Sau đó mở lại Waydroid theo cách thường dùng, thử một trang HTTPS bạn tin cậy từ trình duyệt Android. Phân biệt lỗi kết nối IP với lỗi phân giải tên miền (DNS). Nếu vào được trang từ host nhưng không được từ Android, đó vẫn là lỗi cần điều tra. Không coi ping thất bại đơn lẻ là bằng chứng Internet mất vì đích có thể chặn ICMP.

### 3.5. Khi lỗi giữa chừng

Script chỉ dùng `set -e`, không có rollback tự động. Sysctl có thể đã bật trước khi UFW reload hoặc restart service thất bại. Không mặc định “lệnh lỗi thì không thay gì”.

| Dấu hiệu | Cách xử lý an toàn |
| --- | --- |
| Báo phải chạy root | Không có thay đổi theo luồng chính; xem lại mục đích và quyền trước khi dùng sudo |
| UFW reload lỗi | Sysctl và file UFW có thể đã đổi; đọc trạng thái, lưu lỗi, cân nhắc phục hồi |
| In “khong con la DROP -> bo qua” | Không khẳng định policy an toàn hay đã đúng; đọc nguyên giá trị và định dạng thực tế |
| Table nft không tồn tại | Kiểm tra service/log; output bị cắt không phải bằng chứng cấu hình hoàn chỉnh |
| Restart hoặc `is-active` thất bại | Đọc log service; không mở lại liên tục để che mất nguyên nhân |
| Service active nhưng Android vẫn mất mạng | Chẩn đoán route/DNS/firewall riêng; không lặp script tự động dù dòng cuối gợi ý chạy lại |

### 3.6. Khôi phục thủ công có chọn đúng backup

Không có tham số rollback cho script Waydroid. Khôi phục cần hai việc độc lập: **policy UFW từ backup cụ thể** và **sysctl về giá trị trước đó**. Không đoán sysctl cũ; nếu chưa ghi lại, cần quản trị viên xác định chính sách mong muốn.

Trước tiên đọc danh sách, chọn đúng bản của lần chạy cần hoàn tác, không tự lấy “mới nhất” vì có thể có thay đổi hợp lệ sau đó:

```bash
sudo ls -lt /etc/default/ufw.bak.*
sudo diff -u /etc/default/ufw /etc/default/ufw.bak.EPOCH_DA_CHON
```

Thay `EPOCH_DA_CHON` bằng hậu tố thật đã kiểm tra. Nếu backup có thay đổi khác không liên quan, việc chép toàn bộ sẽ ghi đè chúng; dừng và đánh giá trước. Lưu thêm trạng thái hiện tại nếu cần bảo toàn thay đổi mới.

**Chỉ sau khi đã chọn đúng file và chấp nhận ghi đè**, tự chạy:

```bash
sudo cp -a /etc/default/ufw.bak.EPOCH_DA_CHON /etc/default/ufw
sudo ufw reload
```

Phục hồi sysctl riêng bằng **giá trị đã ghi trước khi sửa**. Ví dụ chỉ khi giá trị cũ thực sự là `0`:

```bash
sudo sysctl -w net.ipv4.ip_forward=0
```

Nếu giá trị cũ là `1`, giữ hoặc đặt lại `1`; không tắt forwarding mù quáng vì có thể làm hỏng VPN/container khác. Phục hồi runtime không sửa các cấu hình sysctl persistent vốn có; không tạo hay xóa cấu hình persistent để “hoàn tác” một việc script không làm.

Cuối cùng kiểm tra lại UFW, sysctl, service và kết nối liên quan. Phục hồi file không tự phục hồi phiên Android hoặc trạng thái dịch vụ ban đầu. Chỉ restart service/mở lại session khi thật sự cần và chấp nhận gián đoạn; **không khuyến nghị `ufw disable`, flush nftables hay xóa toàn bộ rule** để chữa nhanh.

## 4. Checklist trước khi kết luận

- [ ] Đã đọc đúng script tại máy; phiên bản và đường dẫn khớp mục tiêu.
- [ ] Đã lưu công việc, biết tác động và chạy từ terminal ngoài DSH bằng đúng tài khoản.
- [ ] Đã biết backup chứa gì, thiếu gì và chọn được bản cụ thể để phục hồi.
- [ ] Với updater: CLI, dependency, health và GUI đều được kiểm tra sau restart; không gọi rollback là khôi phục toàn bộ.
- [ ] Với Waydroid: ghi giá trị sysctl trước sửa, đánh giá forwarding toàn máy và thử Internet thực từ Android.
- [ ] Nếu có lỗi: lưu nguyên văn lệnh/output đã che bí mật, trạng thái sau lỗi và bước đã thực hiện; không chạy lặp mù quáng.

Tài liệu này mô tả hành vi của mã nguồn hiện có. Việc đọc mã và kiểm tra Markdown không thay cho việc người dùng tự nghiệm thu cập nhật DSH hoặc mạng Waydroid trên máy thật.
