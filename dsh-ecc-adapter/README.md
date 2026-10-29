# ECC–DSH adapter — profile thử nghiệm

Adapter cục bộ cho DSH `0.2.1-rc.2`, đọc nguyên nguồn [ECC](https://github.com/affaan-m/ECC) tại pin `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29`. Không fork hoặc sửa nội dung upstream. Đây là tích hợp **partial**, không phải cam kết tương đương mọi hành vi của Claude Code.

## Thành phần

| Thành phần nguồn | Tích hợp |
| --- | --- |
| 311 skills | First-party filesystem provider, giữ resources; skill project/user hiện có được ưu tiên |
| 97 commands | Namespace `/ecc-*`; queue prompt và arguments qua native `Agent.followup`; command phụ thuộc host/CLI khác bị đánh dấu unsupported |
| 71 agents | Native presets `ecc-*`, persona nguyên bản, tool allowlist và guard theo scope; model mặc định kế thừa route đang dùng |
| 121 rules | Common trước, sau đó language/path phù hợp; literal text và giới hạn context được giữ rõ |
| 27 hook entries | Có inventory đầy đủ; mặc định **tắt**, không tự chạy script upstream |
| 34 MCP templates | Có inventory, không tự khởi động server hoặc nạp credential |
| Memory / observer | Không bật; Hindsight vẫn là owner chính |

Với fixture có đủ 9 tool descriptors chuẩn, nguồn pin đăng ký được **72 commands, 69 agents**; 27 mục còn lại có lý do unsupported. Con số trên host thực phụ thuộc tool có sẵn; không âm thầm nới quyền để tăng số lượng.

## Profile và cách kiểm tra

Bundle chỉ được cài vào `ecc-lab`. Profile `web`, GUI hiện tại, global instructions/skills và ECC source không bị thay đổi.

- Bundle mount: [cordis.patch.yml](<cordis.patch.yml>).
- Snapshot khi mount: `/home/dzerok/.dsh/profiles/ecc-lab/ecc-state/status.json`.
- Lệnh native `/ecc-status` trả inventory, trạng thái và giới hạn hiện hành; không gọi model. Quan sát catalog ghi rõ cwd/scope, skill được chọn từ ECC, skill bị owner hiện có che (`shadowed`) và discovery chưa đầy đủ (`unresolved`). Đăng ký provider không đồng nghĩa 311 skills đều thắng trên mọi project.
- `/ecc-plan <yêu cầu>` queue prompt gốc của ECC; giữ yêu cầu chờ xác nhận có trong prompt.
- Presets có tên `ecc-planner`, `ecc-code-reviewer`… chỉ khả dụng nếu registry báo registered.

Có thể chạy riêng bằng `dsh --profile ecc-lab --port 3081` (chọn cổng khác nếu bận), rồi mở URL do CLI in ra. Profile này được tạo từ template DSH, không sao chép provider credential riêng của `web`; muốn generation cần cấu hình route native. Chưa khởi chạy server/GUI đó trong phiên cài đặt.

Cấu hình được compose bằng `dsh --profile ecc-lab --dump-config`. Thay đổi bundle/profile cần khởi động lại **profile đó**; không tự chuyển hoặc restart GUI `web` đang chạy. Muốn dùng trong GUI hiện tại cần một bước chuyển profile riêng sau khi người dùng chấp thuận. Không coi compose hoặc test fixture là bằng chứng một session GUI đã dùng adapter.

## Hooks: an toàn và giới hạn

`enableHooks: false` là mặc định. Chế độ thử nghiệm `true` yêu cầu `bwrap` hoạt động và luôn báo partial:

- Namespace mạng/PID riêng, environment sạch, source/runtime chỉ đọc; chỉ vùng `hooks-state` được ghi.
- Không mount project, HOME hoặc transcript của host; không gọi Claude CLI hay observer để tự tóm tắt/học.
- Thiếu containment: fail closed, không fallback sang shell không cô lập.
- Không giả `SessionEnd` từ `Stop`; `PreCompact` và lifecycle không có public seam là unsupported.
- `updatedInput` không có seam tương đương → deny; pre-tool context chỉ đến pre-step tiếp theo.
- Async hook có thể quan sát, nhưng quyết định đến muộn không được dùng để phủ quyết ngược thao tác đã admitted.
- System message là model context, không phải thông báo UI; không có Claude transcript nên không claim cost-tracker parity.

Test hooks chạy script **fixture**, không phải mọi script ECC thật. Chưa verify hiệu quả tác vụ thực hoặc generation từ model.

## Kiểm thử và tái lập

Từ thư mục package:

```bash
pnpm install --ignore-scripts --frozen-lockfile
ECC_ROOT=/home/dzerok/.dsh/ecc/source node --test test/
```

Nếu không truyền `ECC_ROOT`, test mount nguồn thật được skip và không đủ để claim đã kiểm chứng nguồn pin. Suite dùng Cordis, command/tool runtime, filesystem skill provider và preset registry thật; fixture tool bodies không được gọi model hay thực thi dự án.

Dependency được ghim và cài với install scripts tắt. Adapter dùng hook protocol chính chủ `0.2.1-rc.2`, nhưng không mount bridge nguyên bản còn thiếu các seam đã xác minh; phần compatibility được test riêng. Upstream license MIT; YAML ISC. Không publish package riêng tư này.

## Rollback

Dừng dùng `ecc-lab` là đủ để quay lại profile `web` vốn không bị đổi. Nếu muốn gỡ bundle:

```bash
dsh plugin --profile ecc-lab remove dsh-ecc-adapter
```

Khởi động lại profile liên quan sau khi gỡ. Không xóa ECC source, global skills, Hindsight hoặc dữ liệu khác. Snapshot và `hooks-state` được giữ để người dùng quyết định dọn sau.
