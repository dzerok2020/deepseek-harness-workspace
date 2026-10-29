# Checkpoint ECC–DSH adapter

## Trạng thái bàn giao

- Người dùng đã chọn adapter trong profile thử nghiệm riêng; bản cài ở `ecc-lab`, không chuyển GUI `web` hiện tại.
- Kế hoạch và phạm vi: [10-intent.md](<10-intent.md>). Hướng dẫn sử dụng/rollback: [README adapter](<../../../../dsh-ecc-adapter/README.md>).
- DSH `0.2.1-rc.2`, Node `26.8.2`; ECC pin `b92f181b3b748d1abbc2afd94af6aa7d8c8fca29`. Không sửa nội dung ECC, global instructions/skills hoặc profile web.
- Package được link bằng CLI chính chủ, dependency ghim và install scripts tắt. Profile compose có đúng một entry adapter. Không khởi động server mới hoặc gọi model ngoài.
- Trạng thái tích hợp **partial**, không phải full behavioral parity. Hook mặc định tắt; MCP và ECC memory/observer không bật; Hindsight vẫn là owner.

## Thành phần và giới hạn

- Inventory đầy đủ: 311 skills, 97 commands, 71 agents, 121 rules, 27 hook entries, 34 MCP templates.
- First-party filesystem skill provider giữ resources; project/user/native owner hiện có được ưu tiên. `/ecc-status` quan sát catalog theo cwd/scope, phân biệt `native-registered`, `shadowed`, `unresolved`; không lấy số nguồn làm số thắng trên host.
- Fixture có 9 tool descriptors chuẩn đăng ký 72 commands và 69 agents, 27 mục unsupported có lý do. Đây không phải số đã đo trong GUI thật. Model alias kế thừa route native, không giả là Opus/Sonnet.
- Rules giữ nguyên common trước language/path; hỗ trợ batch `files`, budget mặc định 131072 bytes, overflow giữ common nếu đủ và báo partial rõ ràng.
- Hook compatibility dùng protocol chính chủ và bwrap khi opt-in. Test fixture kiểm containment, monotonic admission và Stop reentry; không chạy mọi hook ECC upstream. Lifecycle thiếu, updatedInput, transcript và async decision gaps vẫn được báo.

## Bằng chứng đã chạy

Lệnh full suite cuối, chạy từ thư mục adapter qua entry đã cài:

```bash
ECC_ROOT=/home/dzerok/.dsh/ecc/source \
ECC_PLUGIN_ENTRY=/home/dzerok/.dsh/profiles/ecc-lab/node_modules/dsh-ecc-adapter/lib/index.js \
node --test --test-concurrency=1 test/
```

Kết quả nguyên văn:

```text
ℹ tests 61
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
[exit code: 0]
```

- Test dùng public Cordis/Loader, command/tool runtime, skill provider và preset registry thật. Tool bodies/messaging fixture không gọi LLM. Hook fixtures có canary environment/filesystem/network namespace, không phải upstream hook acceptance.
- Regression: `dsh-loop-guard` 22/22, `dsh-vibe-guard` 92/92, ECC hook generator `Passed: 11, Failed: 0`; exit 0.
- Review Standards và Spec độc lập đã phát hiện và sửa: deny bị waterfall override, Stop reentry, source dirty tại matching HEAD, batch path rules, context overflow và thiếu skill-owner diagnostics. Có regression RED → GREEN cho các lỗi này; fixture diagnostics cuối RED 0 pass/2 fail → GREEN 3/3.
- Health trước cài: `KẾT QUẢ: 42 đạt, 1 lỗi, 2 bỏ qua`. Sau cài: `KẾT QUẢ: 41 đạt, 1 lỗi, 2 bỏ qua`. Cùng nhóm lỗi model policy/catalog có trước; không sửa model route ngoài phạm vi. Hai skip gồm compose refresh và Hindsight paid extraction.
- Web manifest/patch SHA256 đối chiếu baseline không đổi; source ECC Git clean. Không sửa checkout DSH. Dependency Node minimum được nâng thành `>=22.5.0` do `path.matchesGlob`; thực tế chỉ verify Node 26.8.2.

## Chưa verify và rủi ro còn lại

- Chưa boot GUI/session model thật bằng `ecc-lab`, chưa có screenshot hoặc chứng cứ generation. Compose và installed-entry fixture không thay thế nghiệm thu đó.
- Chưa chạy toàn bộ hook upstream, MCP có credential, external CLI/model hoặc hệ memory ECC. Không có quyền suy ra chúng tương đương host gốc.
- Không tự cập nhật upstream: source hiện có được giữ nguyên pin đã review. Đổi pin cần review/test lại; source dirty hoặc revision mismatch bị chặn.
- `ecc-lab` được tạo từ template web đi kèm DSH, không sao chép credential/config provider riêng của profile đang dùng. Muốn generation cần cấu hình route native trong profile thử nghiệm.

## Dùng và rollback

Có thể chủ động chạy profile thử nghiệm bằng lệnh sau; chưa được tự khởi chạy trong phiên này:

```bash
dsh --profile ecc-lab --port 3081
```

Nếu cổng đang bận, chọn cổng khác. Mở URL do CLI in ra, dùng `/ecc-status` trước `/ecc-plan <yêu cầu>`. Thay đổi bundle cần restart đúng profile; không tự chuyển GUI hiện tại.

Rollback: ngừng dùng `ecc-lab` để quay lại `web` vốn không đổi, hoặc:

```bash
dsh plugin --profile ecc-lab remove dsh-ecc-adapter
```

Không xóa source ECC, global skills, Hindsight hoặc data của người dùng. Không push remote.
